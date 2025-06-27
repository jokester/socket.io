import type * as CF from '@cloudflare/workers-types';
import {WorkerBindings} from './workerApp';
import {lazy} from './utils/lazy';
import {Hono} from 'hono';
import {DistantSocketAddress, SioActor} from './SioActor';
import {buildSend} from './utils/send';
import {createDebugLogger} from './utils/logger';
import type {SendOptions} from 'engine.io/lib/socket';
import * as EngineStub from './EngineStub';
import {Deferred} from '@jokester/ts-commonutil/lib/concurrency/deferred';
import {wait} from '@jokester/ts-commonutil/lib/concurrency/timing';

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

/**
 * WS handler running engine.io code
 * - keeps 1 transport : TS = eio.Socket + eio.WebSocket
 * - forwards incoming message to socket.io code
 */
export class EngineActor implements CF.DurableObject {
  // @ts-expect-error
  static readonly send = buildSend<Methods>();

  private get eioSid(): string {
    return this.state.id.toString();
  }

  private readonly _socket = new Deferred<EngineStub.EioSocket>(true);

  private get socket(): Promise<EngineStub.EioSocket> {
    return Promise.race([
      this._socket,
      wait(1e3).then(() => {
        throw new Error(`socket not available`);
      }),
    ]);
  }

  constructor(
    private state: CF.DurableObjectState,
    private readonly env: WorkerBindings
  ) {}

  private async onEioSocket(sid: string, socket: EngineStub.EioSocket) {
    const destId = this.env.sioActor.idFromName('singleton');

    const addr: DistantSocketAddress = {
      socketId: sid,
      doId: this.state.id.toString() as unknown as string,
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

        const sid = this.eioSid;
        /**
         * TODO remove tags
         */
        const tags = [`sid:${sid}`];
        this.state.acceptWebSocket(serverSocket, tags);
        const socket = EngineStub.createEioSocket(sid, serverSocket);

        await this.onEioSocket(sid, socket);
        this._socket.fulfill(socket);
        return new self.Response(null, {status: 101, webSocket: clientSocket});
      })
      .post('/sendPackets', async ctx => {
        const [sid, encodedPackets, options]: Parameters<
          Methods['sendPackets']
        > = await ctx.req.json();
        debugLogger('sendPackets', sid, encodedPackets, options);
        const socket = await this.socket;
        socket.write(encodedPackets, options);
        return ctx.json({});
      })
      .post('/closeSocket', async ctx => {
        const [sid, cause]: Parameters<Methods['closeSocket']> =
          await ctx.req.json();
        debugLogger('closeSocket', sid, cause);
        return ctx.json({});
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
    this.socket.then(s => s.onCfClose());
  }

  webSocketMessage(
    ws: CF.WebSocket,
    message: string | ArrayBuffer
  ): void | Promise<void> {
    debugLogger('webSockerMessage', ws, message);
    this.socket.then(s =>
      s.onCfMessage(
        typeof message === 'string'
          ? message
          : Buffer.from(new Uint8Array(message))
      )
    );
  }

  webSocketError(ws: CF.WebSocket, error: unknown): void | Promise<void> {
    debugLogger('websocket error', error);
    this.socket.then(s => s.onCfError('WebSocket Error', String(error)));
  }
}
