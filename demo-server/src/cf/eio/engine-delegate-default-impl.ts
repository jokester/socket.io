import {EngineDelegate} from "./engine-delegate";
import type * as CF from "@cloudflare/workers-types";
import type {SocketActor} from "./SocketActor";

export class EngineDelegateDefaultImpl extends EngineDelegate {

    getSioActorStub(eioSessionId: string): CF.DurableObjectStub<SocketActor> {
        const destId = this.socketActorBinding.idFromString('singleton')
        return this.socketActorBinding.get(destId)
    }
}
