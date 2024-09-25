import type * as CF from '@cloudflare/workers-types';
import type {WorkerBindings} from "./workerApp";
import {lazy} from "@jokester/socket.io-serverless/src/utils/lazy";
import {Hono} from "hono";
// @ts-ignore
import type * as eio from 'engine.io/lib/engine.io.ts'
import type {WebSocket as WsWebSocket} from 'ws'
import {EventEmitter} from "events";
// @ts-ignore
import {DurableObject} from "cloudflare:workers";
// @ts-ignore
import {WebSocket as EioWebSocketTransport} from 'engine.io/lib/transports/websocket';
// @ts-ignore
import {Socket as EioSocket} from 'engine.io/lib/socket'
import {EioWebSocket} from "@jokester/socket.io-serverless/src/EngineStub";
import {DefaultMap} from "@jokester/ts-commonutil/lib/collection/default-map";
import debug from 'debug'
import {SocketActor} from "./SocketActor";
// import {EioSocket, EioWebSocket} from "@jokester/socket.io-serverless/src/EngineStub";

const debugLogger = debug('sio-serverless:EngineActor');
declare const self: CF.ServiceWorkerGlobalScope;

/**
 * Works in place of a engine.io Server
 * - accepts incoming WebSocket connection
 * - emit eio.Socket
 */
export class EngineActor extends DurableObject<WorkerBindings> implements CF.DurableObject {

    constructor(...args: any[]) {
        super(...args);
        this._init()
    }

    // @ts-ignore
    fetch(request: Request): Response | Promise<Response> {
        // debugLogger('engineActor.fetch', this, request.url);

        return this.honoApp.value.fetch(request)
    }

    // @ts-ignore
    private readonly honoApp = lazy(() => createHandler(this, this.ctx, this.env))
    readonly _transports = new DefaultMap<string, CustomSocket>((sessionId) => {
        const tag = `sid:${sessionId}`

        const ws = this._ctx.getWebSockets(tag)
        if (ws.length !== 1) {
            throw new Error(`no websocket found for sid=${sessionId}`)
        }
        debugLogger('revived transport/eio.socket for sid', sessionId)
        // FIXME: when reviving , should not send message like
        // 0{"sid":"d6d2b73e9b","upgrades":[],"pingInterval":20000,"pingTimeout":25000}
        const transport = CustomTransport.create(ws[0]!)
        return CustomSocket.create(this, sessionId, transport)
    })

    webSocketMessage(ws: CF.WebSocket, message: string | ArrayBuffer): void | Promise<void> {
        const {sessionId, socketActorId} = this.getWebsocketMeta(ws)

        const socket = this._transports.getOrCreate(sessionId)!
        debugLogger('ws message', sessionId, message)

        socket.setupOutgoingEvents()
        socket.onCfMessage(message as string)
        // decode ws message
        // forward to SocketActor

    }

    webSocketClose(ws: CF.WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void> {
        const {sessionId, socketActorId} = this.getWebsocketMeta(ws)
        const socket = this._transports.getOrCreate(sessionId)!
        debugLogger('EngineActor#webSocketClose', sessionId, code, reason, wasClean)
        socket.setupOutgoingEvents()
        socket.onCfClose()
        this._transports.delete(sessionId)
    }

    webSocketError(ws: CF.WebSocket, error: unknown): void | Promise<void> {
        const {sessionId, socketActorId} = this.getWebsocketMeta(ws)
        const socket = this._transports.getOrCreate(sessionId)!
        debugLogger('EngineActor#webSocketError', sessionId, error)
        socket.setupOutgoingEvents()
        socket.onCfError('error', String(error))
    }

    sendMessage(eiOSocketId: string, message: string | Buffer) {
        debugLogger('EngineActor#sendMessage', eiOSocketId, message)
        const dest = this._transports.getOrCreate(eiOSocketId)
        dest._transport._stubWs.send(message)
    }

    get _env(): WorkerBindings {
        // @ts-ignore
        return this.env as WorkerBindings
    }

    get _ctx(): CF.DurableObjectState {
        // @ts-ignore
        return this.ctx
    }

    getWebsocketMeta(ws: CF.WebSocket): { sessionId: string, socketActorId: CF.DurableObjectId } {
        const tags = this._ctx.getTags(ws)
        const sessionTag = tags.find(tag => tag.startsWith('sid:'))
        if (!sessionTag) {
            throw new Error('no session tag found')
        }
        const sessionId = sessionTag.slice('sid:'.length)
        return {
            sessionId,
            socketActorId: this._env.socketActor.idFromName('singleton')
        }
    }

    private _inited = false
    private _init() {
        if (this._inited) {
            return
        }
        debugLogger('EngineActor#_init')
        this._inited = true
    }

}

function createHandler(actor: EngineActor, actorCtx: CF.DurableObjectState, actorEnv: WorkerBindings) {

    return new Hono()

        .get('/socket.io/*', async ctx => {
            if (ctx.req.header('Upgrade') !== 'websocket') {
                return new Response(null, {
                    status: 426,
                    statusText: 'Not a Upgrade request',
                });
            }

            const socketId = ctx.req.query('eio_sid')!
            if (socketId?.length !== 10) {
                return new Response(null, {
                    status: 400,
                    statusText: `invalid eio_sid: ${socketId}`,
                })
            }

            debugLogger('new ws connection', ctx.req.url, socketId);
            const {0: clientSocket, 1: serverSocket} = new self.WebSocketPair();
            // TODO: if req contains a Engine.io sid, should query engine.io server to follow the protocol

            const sid = socketId
            /**
             * TODO encode stuff into tags
             */
            const tags = [`sid:${sid}`];
            actorCtx.acceptWebSocket(serverSocket, tags);
            // serverSocket.send('hello')
            // const socket = actor._transports.getOrCreate(sid)
            const transport = CustomTransport.create(serverSocket);
            const eioSocket = CustomSocket.create(actor, sid, transport);

            debugLogger('created transport for sid', sid)
            actor._transports.set(sid, eioSocket)

            // const stub = env.socketActor.get(env.socketActor.idFromString('singleton'))
            // await stub.onEioSocketConnection(actorCtx.id, sid)

            // await actor.onEioSocket(sid, transport);
            return new self.Response(null, {status: 101, webSocket: clientSocket});
        })
}

class CustomTransport extends EioWebSocketTransport {
    constructor(readonly _stubWs: StubWsWebSocket, stubReq: eio.EngineRequest) {
        super(stubReq);
    }
    get _socket() {
        // @ts-expect-error use of private
        return this.socket;
    }

    static create(cfWebSocket: CF.WebSocket): CustomTransport {
        const stubWebSocket = StubWsWebSocket.create(cfWebSocket);
        const stubReq = createStubRequest(stubWebSocket);
        const transport = new CustomTransport(stubWebSocket, stubReq);
        debugLogger('sio-serverless:CustomTransport created')
        return transport;
    }
}

interface SocketMeta {

}
/**
 * A stub that should still emit the following events (used by sio.Client)
 * - data
 * - error
 * - close
 */
export class CustomSocket extends EioSocket {
    static create(eioActor: EngineActor, sid: string, transport: CustomTransport): CustomSocket {
        return new CustomSocket(eioActor, sid, transport);
    }

    private _setupDone = false;

    constructor(private readonly eioActor: EngineActor, private readonly _sid: string, readonly _transport: CustomTransport) {
        super(_sid, createStubEioServer(), _transport, null, 4);
    }

    setupOutgoingEvents() {
        if (this._setupDone) {
            return
        }
        debugLogger('setup outgoing events', this._sid)
        const eioAddr = this.eioActor._ctx.id;
        const destId = this.eioActor._env.socketActor.idFromName('singleton')
        // @ts-ignore
        const destStub: SocketActor = this.eioActor._env.socketActor.get(destId)

        // TODO: close/error events may should be short circuited
        this.on('data', data => destStub.onEioSocketData(eioAddr, this._sid, data));
        this.on('close', (code, reason) => destStub.onEioSocketClose(eioAddr, this._sid, code, reason));
        this.on('error', error => destStub.onEioSocketError(eioAddr, this._sid, error));
        destStub.onEioSocketConnection(eioAddr, this._sid)

        this._setupDone = true
    }

    schedulePing() { /* noop to prevent 'window' NPE FIXME should work around better */
        this.sendPacket('ping')
    }

    onCfClose() {
        (this.transport as CustomTransport)._socket.emit('close');
    }

    onCfMessage(msg: string | Buffer) {
        debugLogger('onCfMessage', this.sid, msg);
        const msgStr = typeof msg === 'string' ? msg : msg.toString();
        (this.transport as EioWebSocket)._socket.emit('message', msgStr);
    }

    onCfError(msg: string, desc?: string) {
        (this.transport as EioWebSocket)._socket.emit('error', new Error(msg));
    }
}

class StubWsWebSocket extends EventEmitter {
    static create(cfWebSocket: CF.WebSocket): WsWebSocket & StubWsWebSocket {
        return new StubWsWebSocket(cfWebSocket) as any;
    }
    constructor(private readonly cfWebSocket: CF.WebSocket) {
        super();
    }

    get _socket() {
        return {
            remoteAddress: 'FIXME: 127.0.0.1',
        }
    }

    send(
        data: string | Buffer,
        _opts?: unknown,
        _callback?: (error?: any) => void
    ) {
        try {
            this.cfWebSocket.send(data);
            debugLogger('StubWsWebSocket.send', data);
            _callback?.();
        } catch (e: any) {
            debugLogger('StubWsWebSocket.send error', data, e);
            _callback?.(e);
        }
    }
    close() {
        this.cfWebSocket.close()
    }

}

function createStubEioServer() {
    const server = new EventEmitter();
    Object.assign(server, {
        opts: {
            pingInterval: 200000,
            pingTimeout: 250000,
        } as eio.ServerOptions,
        upgrades: () => [],
    });
    return server;
}

function createStubRequest(
    websocket: WsWebSocket
): eio.EngineRequest {
    return {
        // @ts-expect-error
        _query: {
            sid: '',
            EIO: '4',
        },
        websocket,
    };
}

