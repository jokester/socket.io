import type * as CF from '@cloudflare/workers-types';
import {ConnectionState, SioServer} from './SioServer'
import {EngineActorBase} from "../eio/EngineActorBase";

const PERSIST_KEY_CONNECTION_LIST = '__connections__'

export async function createSioServer(ctx: CF.DurableObjectState, engineActorNs: CF.DurableObjectNamespace<EngineActorBase>): Promise<SioServer> {
    const created = new SioServer(ctx, engineActorNs, save)
    // TODO: revive persisted state
    return created

    async function save(eioSocketId: string, connState: ConnectionState) {
        // TODO
    }
}

