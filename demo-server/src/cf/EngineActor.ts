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
        const transport = CustomTransport.create(ws[0]!)
        return CustomSocket.create(sessionId, transport)
    })


    webSocketClose(ws: CF.WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void> {
        const {sessionId, socketActorId} = this.getWebsocketMeta(ws)
        const socket = this._transports.getOrCreate(sessionId)!
        debugLogger('EngineActor#webSocketClose', sessionId, code, reason, wasClean)
        this._transports.delete(sessionId)
        socket.onCfClose()
    }

    webSocketError(ws: CF.WebSocket, error: unknown): void | Promise<void> {
        const {sessionId, socketActorId} = this.getWebsocketMeta(ws)
        const socket = this._transports.getOrCreate(sessionId)!
        debugLogger('EngineActor#webSocketError', sessionId, error)
        socket.onCfError('error', String(error))
    }

    get _env() {
        // @ts-ignore
        return this.env as WorkerBindings
    }

    get _ctx(): CF.DurableObjectState {
        // @ts-ignore
        return this.ctx
    }

    webSocketMessage(ws: CF.WebSocket, message: string | ArrayBuffer): void | Promise<void> {
        const {sessionId, socketActorId} = this.getWebsocketMeta(ws)

        const socket = this._transports.getOrCreate(sessionId)!
        debugLogger('ws message', sessionId, message)

        socket.onCfMessage(message as string)

        // decode ws message
        // forward to SocketActor

    }

    private getWebsocketMeta(ws: CF.WebSocket): { sessionId: string, socketActorId: CF.DurableObjectId } {
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

}

export interface EngineActorAddr {

}

function createHandler(actor: EngineActor, actorCtx: CF.DurableObjectState, env: WorkerBindings) {

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
            const eioSocket = CustomSocket.create(sid, transport);

            debugLogger('created transport for sid', sid)
            actor._transports.set(sid, eioSocket)

            // const stub = env.socketActor.get(env.socketActor.idFromString('singleton'))
            // await stub.onEioSocketConnection(actorCtx.id, sid)

            // await actor.onEioSocket(sid, transport);
            return new self.Response(null, {status: 101, webSocket: clientSocket});
        })
}

class CustomTransport extends EioWebSocketTransport {
    get _socket() {
        // @ts-expect-error use of private
        return this.socket;
    }

    static create(cfWebSocket: CF.WebSocket): CustomTransport {
        const stubWebSocket = createStubWebSocket(cfWebSocket);
        const stubReq = createStubRequest(stubWebSocket);
        return new CustomTransport(stubReq);
    }
}

export class CustomSocket extends EioSocket {
    static create(sid: string, transport: CustomTransport): CustomSocket {
        return new CustomSocket(sid, transport);
    }

    constructor(private readonly sid: string, readonly transport: CustomTransport) {
        super(sid, createStubEioServer(), transport, null, 4);
    }

    schedulePing() { /* noop to prevent 'window' NPE FIXME should work around better */
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

function createStubWebSocket(cfWebSocket: CF.WebSocket): WsWebSocket {
    const stub: WsWebSocket = new EventEmitter() as WsWebSocket;
    Object.assign(stub, {
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
        close: () => cfWebSocket.close()
    });
    return stub;
}

function createStubEioServer() {
    const server = new EventEmitter();
    Object.assign(server, {
        opts: {
            pingInterval: 20000,
            pingTimeout: 25000,
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

