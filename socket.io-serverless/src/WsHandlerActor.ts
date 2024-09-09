import type * as CF from '@cloudflare/workers-types';
import {WorkerBindings} from "./workerApp";
class WsHandlerActor implements CF.DurableObject {
    constructor(
        private state: CF.DurableObjectState,
        private readonly env: WorkerBindings
    ) {}




}

class SocketIoActor {

}
