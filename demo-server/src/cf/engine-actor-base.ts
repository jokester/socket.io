import debugModule from 'debug'
import type * as CF from '@cloudflare/workers-types';

// @ts-ignore
import {DurableObject} from "cloudflare:workers";
import {Hono} from "hono";
import {CustomEioWebsocketTransport} from "./stub/eio-ws-transport";
import {CustomEioSocket} from "./stub/eio-socket";
import {lazy} from "@jokester/socket.io-serverless/src/utils/lazy";
import {EngineDelegate, EioSocketState} from "./engine-delegate";
import {SocketActor} from "./SocketActor";

const debugLogger = debugModule('sio-serverless:EngineActorBase');

declare const self: CF.ServiceWorkerGlobalScope;

export abstract class EngineActorBase<Env = unknown> extends DurableObject<Env> implements CF.DurableObject {
    private _delegate: EngineDelegate = null!

    // @ts-ignore
    fetch(request: Request): Response | Promise<Response> {
        // debugLogger('engineActor.fetch', this, request.url);

        return this.honoApp.value.fetch(request)
    }

    getDelegate(): EngineDelegate {
        if (!this._delegate) {
            this._delegate = this.createDelegate()
        }
        return this._delegate
    }

    get _ctx(): CF.DurableObjectState {
        // @ts-ignore
        return this.ctx
    }

    get _env(): Env {
        // @ts-ignore
        return this.env
    }

    protected abstract createDelegate(): EngineDelegate;

    /**
     * extension point for load-balancing
     */
    protected abstract getSocketActorStub(sessionId: string): CF.DurableObjectStub<SocketActor>
    // called on outgoing client messages
    protected abstract recallSocketStateForId(eioSocketId: string): null | EioSocketState;
    // called on incoming client messages
    protected abstract recallSocketStateForConn(ws: CF.WebSocket): null | EioSocketState
    protected abstract recallSocket(state: EioSocketState): null | CustomEioSocket;

    async onNewConnection(eioSocketId: string, serverSocket: CF.WebSocket): Promise<CustomEioSocket> {
        const transport = CustomEioWebsocketTransport.create(serverSocket);
        const sioActorStub = this.getSocketActorStub(eioSocketId)
        const newSocketState: EioSocketState = {
            eioActorId: this._ctx.id,
            eioSocketId,
            socketActorStub: sioActorStub,
        }
        const eioSocket = new CustomEioSocket(newSocketState, transport);

        await sioActorStub.onEioSocketConnection(newSocketState.eioActorId, eioSocketId)
        return eioSocket
    }

    private readonly honoApp = lazy(() => createHandler(this, this._ctx))
}

function createHandler(actor: EngineActorBase, actorCtx: CF.DurableObjectState) {
    return new Hono()
        // @ts-ignore hono.Response is not CF.Response
        .get('/socket.io/*', async ctx => {
            if (ctx.req.header('Upgrade') !== 'websocket') {
                return new Response(null, {
                    status: 426,
                    statusText: 'Not a Upgrade request',
                });
            }

            const socketId = ctx.req.query('eio_sid')!
            if (socketId?.length !== 10) {
                // FIXME: should limit minimal length instaed
                return new Response(null, {
                    status: 400,
                    statusText: `invalid eio_sid: ${socketId}`,
                })
            }

            debugLogger('new ws connection', ctx.req.url, socketId);
            const {0: clientSocket, 1: serverSocket} = new self.WebSocketPair();

            const sid = socketId
            const tags = [`sid:${sid}`];
            await actor.onNewConnection(sid, serverSocket)
            actorCtx.acceptWebSocket(serverSocket, tags);
            return new self.Response(null, {status: 101, webSocket: clientSocket});
        })
}
