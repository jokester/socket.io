import type {Namespace} from "socket.io";
import {Adapter} from "socket.io-adapter";
import debugModule from "debug";

const debugLogger = debugModule('sio-serverless:sio:SingleActorAdapter');

/**
 * Works in place of InMemoryAdapter
 * - x
 * - handles state recovery before/after DO hibernation
 */
export class SingleActorAdapter extends Adapter {
    constructor(private readonly nsp: Namespace) {
        super(nsp);
        debugLogger('SingleActorAdapter#constructor', nsp.name)
    }

}
