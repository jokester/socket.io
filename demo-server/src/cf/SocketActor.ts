import type * as CF from '@cloudflare/workers-types';
import {DurableObject} from "cloudflare:workers";
import type {WorkerBindings} from "./workerApp";
import debug from 'debug'

const debugLogger = debug('sio-serverless:SocketActor');

declare const self: CF.ServiceWorkerGlobalScope;
export class SocketActor extends DurableObject<WorkerBindings> implements CF.DurableObject {

    fetch(req: CF.Request) {
        throw new Error('Method not implemented.');
        return new self.Response(null)
    }

    onEioSocketConnection(actorAddr: CF.DurableObjectId, socketId: string) {
        throw new Error('Method not implemented.');
    }
    onEioSocketData(actorAddr: CF.DurableObjectId, socketId: string, data: unknown) {
        debugLogger('SocketActor#onEioSocketData', actorAddr, socketId, data)
        // throw new Error('Method not implemented.');
    }

    onEioSocketClose(actorAddr: CF.DurableObjectId, socketId: string, code: number, reason: string) {
        debugLogger('SocketActor#onEioSocketClose', actorAddr, socketId, code, reason)
    }

    onEioSocketError(actorAddr: CF.DurableObjectId, socketId: string, error: unknown) {
        debugLogger('SocketActor#onEioSocketError', actorAddr, socketId, error)
    }
}

