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
import {Socket as EioSocket} from 'engine.io/lib/socket'
import {EioWebSocket} from "@jokester/socket.io-serverless/src/EngineStub";
import {DefaultMap} from "@jokester/ts-commonutil/lib/collection/default-map";
import debug from 'debug'
import {SocketActor} from "./SocketActor";
import {CustomEioWebsocketTransport} from "./stub/eio-ws-transport";
import {CustomEioSocket} from "./stub/eio-socket";
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
    readonly _transports = new DefaultMap<string, CustomEioSocket>((sessionId) => {
        const tag = `sid:${sessionId}`

        const ws = this._ctx.getWebSockets(tag)
        if (ws.length !== 1) {
            throw new Error(`no websocket found for sid=${sessionId}`)
        }
        debugLogger('revived transport/eio.socket for sid', sessionId)
        // FIXME: when reviving , should not send message like
        // 0{"sid":"d6d2b73e9b","upgrades":[],"pingInterval":20000,"pingTimeout":25000}
        const transport = CustomEioWebsocketTransport.create(ws[0]!)
        return CustomEioSocket.create(this, sessionId, transport)
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

    /**
     * called by SocketActor which thinks it's writing to eio.Socket
     * @param eiOSocketId
     * @param message
     */
    sendMessage(eiOSocketId: string, message: string | Buffer) {
        debugLogger('EngineActor#sendMessage', eiOSocketId, message)
        const dest = this._transports.getOrCreate(eiOSocketId)
        dest.write(message);
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
            const transport = CustomEioWebsocketTransport.create(serverSocket);
            const eioSocket = CustomEioSocket.create(actor, sid, transport);

            debugLogger('created transport for sid', sid)
            actor._transports.set(sid, eioSocket)

            // const stub = env.socketActor.get(env.socketActor.idFromString('singleton'))
            // await stub.onEioSocketConnection(actorCtx.id, sid)

            // await actor.onEioSocket(sid, transport);
            return new self.Response(null, {status: 101, webSocket: clientSocket});
        })
}
