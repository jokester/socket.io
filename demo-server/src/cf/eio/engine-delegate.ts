import debugModule from 'debug'
import type * as CF from '@cloudflare/workers-types';
import {DefaultMap} from "@jokester/ts-commonutil/lib/collection/default-map";
import {ServerlessEioSocket} from "./eio.stub/serverless-eio-socket";
import {EioSocketState} from "./EngineActorBase";

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
    getEioSocket(state: EioSocketState, isNewConnection: boolean): null | ServerlessEioSocket {
        // FIXME
        return this._sockets.getOrCreate(state.eioSocketId)
    }

    private readonly _sockets = new DefaultMap<string, ServerlessEioSocket>((sessionId) => {

    })
}

/**
 * serializable state to keep across EngineActor lifecycles
 * managed by EngineActor
 */
export interface EngineDelegateState {

}

