import type * as CF from '@cloudflare/workers-types';
import type {WorkerBindings} from "./workerApp";

declare const self: CF.ServiceWorkerGlobalScope;
export class SocketActor implements CF.DurableObject {

    fetch(req: CF.Request) {
        throw new Error('Method not implemented.');
        return new self.Response(null)
    }

    onEioSocketMessage(actorAddr: CF.DurableObjectId, socketId: string, message: string) {
        throw new Error('Method not implemented.');
    }

    onEioSocketClose(actorAddr: CF.DurableObjectId, socketId: string, code: number, reason: string) {

    }

    onEioSocketError(actorAddr: CF.DurableObjectId, socketId: string, error: unknown) {
    }
}

