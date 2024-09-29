import debugModule from 'debug'
import type * as CF from '@cloudflare/workers-types';
import {DefaultMap} from "@jokester/ts-commonutil/lib/collection/default-map";
import {CustomEioSocket} from "./stub/eio-socket";
import {CustomEioWebsocketTransport} from "./stub/eio-ws-transport";
import type {SocketActor} from "./SocketActor";

const debugLogger = debugModule('sio-serverless:EngineActorDelegate');

/**
 * replaces eio.Server
 */
export abstract class EngineDelegate {
    constructor() {
    }

    abstract getSioActorStub(sessionId: string): CF.DurableObjectStub

    /**
     *
     * @param state
     * @param isNewConnection
     */
    getEioSocket(state: EioSocketState, isNewConnection: boolean): null | CustomEioSocket {
        // FIXME
        return this._sockets.getOrCreate(state.eioSocketId)
    }

    private readonly _sockets = new DefaultMap<string, CustomEioSocket>((sessionId) => {

    })
}

/**
 * serializable state to keep across EngineActor lifecycles
 * managed by EngineActor
 */
export interface EngineDelegateState {

}

/**
 * non-serializable state for a WebSocket connection
 * persisted in EngineActor but by EngineDelegate
 */
export interface EioSocketState {
    eioActorId: CF.DurableObjectId,
    eioSocketId: string
    // @ts-expect-error
    socketActorStub: CF.DurableObjectStub<SocketActor>
}
