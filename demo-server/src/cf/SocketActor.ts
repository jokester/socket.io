import type * as CF from '@cloudflare/workers-types';
import type {WorkerBindings} from "./workerApp";

declare const self: CF.ServiceWorkerGlobalScope;
export class SocketActor implements CF.DurableObject {

    fetch(req: CF.Request) {
        return new self.Response(null)
    }
    onEioSocket(add) {

    }

}
