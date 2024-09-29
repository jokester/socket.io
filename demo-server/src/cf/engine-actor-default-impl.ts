import debugModule from 'debug'
import type * as CF from "@cloudflare/workers-types";
import {EngineActorBase} from "./engine-actor-base";
// @ts-ignore
import {EngineDelegateDefaultImpl} from "./engine-delegate-default-impl";
import {EngineDelegate, EioSocketState} from "./engine-delegate";
import {SocketActor} from "./SocketActor";
import {WorkerBindings} from "./workerApp";
import {CustomEioSocket} from "./stub/eio-socket";
import {CustomEioWebsocketTransport} from "./stub/eio-ws-transport";

const debugLogger = debugModule('sio-serverless:EngineActorDefaultImpl');

export class EngineActorDefaultImpl extends EngineActorBase<WorkerBindings> {

    protected _liveConnections = new Map<string, CustomEioSocket>()

    protected getSocketActorStub(sessionId: string):
        // @ts-expect-error
        CF.DurableObjectStub<SocketActor> {
        const ns = this._env.socketActor;
        const addr = ns.idFromName('singleton')
        return ns.get(addr)
    }

    createDelegate(): EngineDelegate {
        return new EngineDelegateDefaultImpl()
    }

    protected recallSocketStateForId(eioSocketId: string): null | EioSocketState {
        const socketActorStub = this.getSocketActorStub(eioSocketId)
        return {
            eioSocketId,
            eioActorId: this._ctx.id,
            socketActorStub,
        }
    }

    protected recallSocketStateForConn(ws: CF.WebSocket): null | EioSocketState {
        const tags = this._ctx.getTags(ws)
        const sessionTag = tags.find(tag => tag.startsWith('sid:'))
        if (!sessionTag) {
            debugLogger("WARNING no conn state found for cf.WebSocket", ws)
            return null
        }
        const eioSocketId = sessionTag.slice('sid:'.length)

        return {
            eioSocketId,
            eioActorId: this._ctx.id,
            socketActorStub: this.getSocketActorStub(eioSocketId)
        }
    }

    override async onNewConnection(eioSocketId: string, serverSocket: CF.WebSocket): Promise<CustomEioSocket> {
        const socket = await super.onNewConnection(eioSocketId, serverSocket)
        this._liveConnections.set(eioSocketId, socket)
        return socket
    }

    protected recallSocket(state: EioSocketState): null | CustomEioSocket {
        {
            const alive = this._liveConnections.get(state.eioSocketId)
            if (alive) {
                return alive
            }
        }
        const tag = `sid:${state.eioSocketId}`

        const ws = this._ctx.getWebSockets(tag)
        if (ws.length !== 1) {
            debugLogger(`WARNING no websocket found for sid=${state.eioSocketId}`)
        }
        const transport = CustomEioWebsocketTransport.create(ws[0]!)
        debugLogger('revived CustomEioSocket for sid', state.eioSocketId)
        return new CustomEioSocket(state, transport)
    }
}

