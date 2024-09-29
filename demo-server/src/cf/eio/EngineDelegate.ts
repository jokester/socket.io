import debugModule from 'debug'
import type * as CF from '@cloudflare/workers-types';
import {EioSocketState} from "./EngineActorBase";
import {SocketActor} from "../SocketActor";
import {Socket} from "./Socket";
import {WebsocketTransport} from "./WebsocketTransport";

const debugLogger = debugModule('sio-serverless:EngineDelegate');

/**
 * extension points for EngineActorBase classes
 */
export interface EngineDelegate {
    /**
     * extension point for load-balancing
     */
    getSocketActorStub(sessionId: string): CF.DurableObjectStub<SocketActor>
    // called on outgoing client messages
    recallSocketStateForId(eioSocketId: string): null | EioSocketState;
    // called on incoming client messages
    recallSocketStateForConn(ws: CF.WebSocket): null | EioSocketState
    recallSocket(state: EioSocketState): null | Socket;
    onNewSocket(eioSocketId: string, socket: Socket): void
}

export class DefaultEngineDelegate implements EngineDelegate {
    private readonly _liveConnections = new Map<string, Socket>()

    constructor(private readonly _ctx: CF.DurableObjectState, private readonly socketActorNs: CF.DurableObjectNamespace<SocketActor>) {
    }

    /**
     * @note this can be overridden for load-balancing
     */
    getSocketActorStub(sessionId: string):
    // @ts-expect-error
        CF.DurableObjectStub<SocketActor> {
        const ns = this.socketActorNs;
        const addr = ns.idFromName('singleton')
        return ns.get(addr)
    }

    recallSocketStateForId(eioSocketId: string): null | EioSocketState {
        const socketActorStub = this.getSocketActorStub(eioSocketId)
        return {
            eioSocketId,
            eioActorId: this._ctx.id,
            socketActorStub,
        }
    }

    recallSocketStateForConn(ws: CF.WebSocket): null | EioSocketState {
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

    onNewSocket(eioSocketId: string, socket: Socket) {
        this._liveConnections.set(eioSocketId, socket)
    }

    recallSocket(state: EioSocketState): null | Socket {
        {
            const alive = this._liveConnections.get(state.eioSocketId)
            if (alive) {
                debugLogger('found alive eio.Socket for sid', state.eioSocketId)
                return alive
            }
        }
        const tag = `sid:${state.eioSocketId}`

        const ws = this._ctx.getWebSockets(tag)
        if (ws.length !== 1) {
            debugLogger(`WARNING no websocket found for sid=${state.eioSocketId}`)
            return null
        }
        const transport = WebsocketTransport.create(ws[0]!)
        const revived = new Socket(state, transport)
        revived.setupOutgoingEvents(state)
        debugLogger('revived eio.Socket for sid', state.eioSocketId)
        return revived
    }
}
