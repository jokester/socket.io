/**
 * @file first version of EngineActor, creates more stuff including a eio.Server
 */
import type * as CF from '@cloudflare/workers-types';
import {WorkerBindings} from './workerApp';
import {lazy} from './utils/lazy';
import {Hono} from 'hono';
import type * as eio from 'engine.io/lib/engine.io';
import {
  BaseServer as EioBaseServer,
  type ErrorCallback as EioErrorCallback,
  type PreparedIncomingMessage,
} from 'engine.io/lib/server';
import {
  WebSocket as EioWebSocketBase,
  type WsWebSocket,
} from 'engine.io/lib/transports/websocket';
import {Deferred} from '@jokester/ts-commonutil/lib/concurrency/deferred';
import {DistantSocketAddress, SioActor} from './SioActor';
import {buildSend} from './utils/send';
import {createDebugLogger} from './utils/logger';
import type {IncomingMessage} from 'node:http';
import {EventEmitter} from 'node:events';
import type {SendOptions} from 'engine.io/lib/socket';

declare const self: CF.ServiceWorkerGlobalScope;

const debugLogger = createDebugLogger('sio-worker:EngineActor');

interface Methods {
  sendPackets(
    sid: string,
    encodedPackets: (string | Buffer)[],
    options: SendOptions
  ): Promise<void>;
  closeSocket(sid: string, cause?: any): Promise<void>;
}

function crateDummyRequest(
  cfWebSocket: CF.WebSocket,
  actor: EngineActor
): PreparedIncomingMessage {
  const fake: WsWebSocket = new EventEmitter() as WsWebSocket;
  Object.assign(fake, {
    _socket: {
      remoteAddress: 'FIXME: 127.0.0.1',
    },
    send(
      data: string | Buffer,
      _opts?: unknown,
      _callback?: (error?: any) => void
    ) {
      try {
        cfWebSocket.send(data);
        debugLogger('fakeWsWebSocket.send', data);
        _callback?.();
      } catch (e: any) {
        debugLogger('fakeWsWebSocket.send error', data, e);
        _callback?.(e);
      }
    },
    close: cfWebSocket.close.bind(cfWebSocket),
  });
  // @ts-expect-error
  return {
    _query: {
      // FIXME: find a way to reuse sid across WS connections. handshake() always create a new sid.
      sid: '',
      EIO: '4',
    },
    websocket: fake,
  };
}

class EioWebSocket extends EioWebSocketBase {
  get _socket(): WsWebSocket {
    // @ts-expect-error
    return this.socket;
  }
  $$constructor(req: any, websocket: CF.WebSocket, actor: EngineActor) {
    // super({ ...req, websocket: createDomWebSocketMock(websocket, actor), });
  }
}

class EioServer extends EioBaseServer {
  constructor(private readonly actor: EngineActor) {
    super({
      transports: ['websocket'],
      perMessageDeflate: false,
    });
  }
  init() {}

  cleanup() {}

  private _sidMap = new WeakMap<object, string>();

  async generateId(req: IncomingMessage, save = false): Promise<string> {
    // logger('generateId', req, save);
    if (save) {
      // fills _sidMap
      const generated = await super.generateId(req as IncomingMessage);
      this._sidMap.set(req, generated);
      return generated;
    } else {
      // when called by base class: consume _sidMap
      const registered = this._sidMap.get(req);
      if (!registered) {
        throw new Error('should not be here');
      }
      return registered;
    }
  }

  protected createTransport(transportName: string, req: any): EioWebSocket {
    if (transportName !== 'websocket') {
      throw new Error('should not be here');
    }
    return new EioWebSocket(req);
  }

  /**
   * works like eio.Server#onWebSocket(req, socket, websocket) but
   * - no middleware or verify yet
   * @param sid
   * @param req
   */
  async onCfSocket(
    sid: string,
    req: ReturnType<typeof crateDummyRequest>
  ): Promise<unknown> {
    const prev = this.clients[sid];
    if (prev) {
      // TODO is this correct?
      debugLogger('WARNING eio.Socket existed with the same sid', sid, prev);
      throw new Error('eio.Socket existed with the same sid');
    }

    const handShaken = new Deferred<unknown>();

    const onHandshakeError: EioErrorCallback = (errCode, errContext) =>
      handShaken.reject(new Error(`${errContext?.message} : ${errCode}`));

    /**
     * inside this.handshake():
     * 1. create eio.WebSocket transfer and eio.Socket wrapping it
     * 2. assign this.clients[sid]
     */
    const t: EioWebSocket = await this.handshake(
      'websocket',
      req,
      onHandshakeError
    );
    // else: a Socket object should be emitted in `this.handshake()` call
    handShaken.fulfill(t);
    await handShaken;
    return t;
  }

  onCfSocketMessage(sid: string, msg: string | Buffer) {
    const socket = this.clients[sid];
    if (!socket) {
      debugLogger('WARNING onCfSocketMessage(): no socket found for sid', sid);
      return;
    }
    const msgStr = typeof msg === 'string' ? msg : msg.toString();
    (socket.transport as EioWebSocket)._socket.emit('message', msgStr);
  }

  onCfSocketClose(sid: string): void {
    const socket = this.clients[sid];
    if (!socket) {
      debugLogger('WARNING onCfSocketClose(): no socket found for sid', sid);
      return;
    }
    (socket.transport as EioWebSocket)._socket.emit('close');
  }

  onCfSocketError(sid: string, msg: string, desc?: string): void {
    const socket = this.clients[sid];
    if (!socket) {
      debugLogger('WARNING onCfSocketError(): no socket found for sid', sid);
      return;
    }
    // this should escalate EioWebSocket > EioSocket
    (socket.transport as EioWebSocket)._socket.emit('error', new Error(msg));
  }

  writeToSocket(
    sid: string,
    encodedPackets: (string | Buffer)[],
    opts: SendOptions
  ) {
    const socket = this.clients[sid];
    if (!socket) {
      debugLogger('WARNING writeToSocket(): no socket found for sid', sid);
      return;
    }
    socket.write(encodedPackets, opts);
  }
}

/**
 * WS based on engine.io
 * - keeps transport : TS = eio.Socket + eio.WebSocket
 * - emits id of new connected Socket (to who?)
 * - emits messages
 * - forwards message to Socket
 */
export class EngineActor implements CF.DurableObject {
  // @ts-expect-error
  static readonly send = buildSend<Methods>();

  constructor(
    private state: CF.DurableObjectState,
    private readonly env: WorkerBindings
  ) {
    // debugLogger('state', state)
    // debugLogger('env', env)
  }
  readonly eioServer = lazy(() => {
    const s = new EioServer(this);
    // FIXME the 2 object exists but inspecting them will cause error
    // like `webgpu needs the webgpu compatibility flag set`
    // logger('globalThis', typeof globalThis === 'object' && globalThis);
    // logger('self', typeof self === 'object' && self);

    s.on('connection', (socket: eio.Socket) => this.onEioSocket(socket));
    return s;
  });

  private async onEioSocket(socket: eio.Socket) {
    // @ts-ignore
    const sid: string = socket.id;
    const destId = this.env.sioActor.idFromName('singleton');

    const addr: DistantSocketAddress = {
      socketId: sid,
      doId: this.state.id as unknown as string,
    };

    await SioActor.send(
      {
        kind: this.env.sioActor,
        id: destId,
      },
      'onConnection',
      [addr]
    ).then(res => {
      debugLogger('onConnection res', res);
    });

    // Because socket.io code runs in different DO, we need to forward events
    socket
      .on('message', msg =>
        SioActor.send(
          {
            kind: this.env.sioActor,
            id: destId,
          },
          'onMessage',
          [addr, msg]
        )
      )
      .on('close', msg =>
        SioActor.send(
          {
            kind: this.env.sioActor,
            id: destId,
          },
          'onConnectionClose',
          [addr, String(msg)]
        )
      )
      .on('error', msg =>
        SioActor.send(
          {
            kind: this.env.sioActor,
            id: destId,
          },
          'onConnectionError',
          [addr, {message: String(msg)}]
        )
      );
  }

  readonly honoApp = lazy(() =>
    new Hono()
      .get('/socket.io/*', async ctx => {
        if (ctx.req.header('Upgrade') !== 'websocket') {
          return new Response(null, {
            status: 426,
            statusText: 'Not a Upgrade request',
          });
        }

        debugLogger('new ws connection', ctx.req.url);
        const {0: clientSocket, 1: serverSocket} = new self.WebSocketPair();
        // TODO: if req contains a Engine.io sid, should query engine.io server to follow the protocol

        const dummyReq = crateDummyRequest(serverSocket, this);
        const sid = await this.eioServer.value.generateId(dummyReq, true);
        const tags = [`sid:${sid}`];
        this.state.acceptWebSocket(serverSocket, tags);
        // serverSocket.accept();

        await this.eioServer.value.onCfSocket(sid, dummyReq);
        // serverSocket.send('wtf');

        return new self.Response(null, {status: 101, webSocket: clientSocket});
      })
      .post('/sendPackets', async ctx => {
        const [sid, encodedPackets, options]: Parameters<
          Methods['sendPackets']
        > = await ctx.req.json();
        debugLogger('sendPackets', sid, encodedPackets, options);
        this.eioServer.value.writeToSocket(sid, encodedPackets, options);
      })
      .post('/closeSocket', async ctx => {
        const [sid, cause]: Parameters<Methods['closeSocket']> =
          await ctx.req.json();
        debugLogger('closeSocket', sid, cause);
      })
  );

  fetch(req: Request): CF.Response | Promise<CF.Response> {
    const {value: app} = this.honoApp;
    // @ts-expect-error
    return app.fetch(req, this.env);
  }

  webSocketClose(
    ws: CF.WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): void | Promise<void> {
    debugLogger('websocketClose', {
      ws,
      code,
      reason,
      wasClean,
    });
    const sid = this.findSid(ws);
    if (!sid) {
      debugLogger('WARNING no sid found for ws', ws);
      return;
    }
    this.eioServer.value.onCfSocketClose(sid);
  }

  private findSid(ws: CF.WebSocket): string | undefined {
    const tags = this.state.getTags(ws);
    return tags.find(tag => tag.startsWith('sid:'))?.slice('sid:'.length);
  }

  webSocketMessage(
    ws: CF.WebSocket,
    message: string | ArrayBuffer
  ): void | Promise<void> {
    debugLogger('webSockerMessage', ws, message);
    const sid = this.findSid(ws);
    if (!sid) {
      debugLogger('WARNING no sid found for ws', ws);
      return;
    }
    this.eioServer.value.onCfSocketMessage(
      sid,
      typeof message === 'string'
        ? message
        : Buffer.from(new Uint8Array(message))
    );
  }

  webSocketError(ws: CF.WebSocket, error: unknown): void | Promise<void> {
    debugLogger('websocket error', error);
    const sid = this.findSid(ws);
    if (!sid) {
      debugLogger('WARNING no sid found for ws', ws);
      return;
    }
    this.eioServer.value.onCfSocketError(sid, 'WebSocket Error', String(error));
  }
}
