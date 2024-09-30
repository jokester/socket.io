import type * as CF from '@cloudflare/workers-types';
import debugModule from "debug";
const debugLogger = debugModule('sio-serverless:sio:Persister');

interface PersistedSioServerState {
    // TODO: persist this, maybe via nsp events
    concreteNamespaces: string[]
    // TODO: persist this, maybe in Client#constructor
    clientIds: string[] // equal to eioSocket.id
}

interface PersistedSioClientState {
    // TODO: persist this, maybe in Client#constructor
    clientId: string;
    engineActorId: CF.DurableObjectId;
    // TODO: persist this, maybe in Adapter
    namespaces: Map</* concrete nsp.name*/ string, {
        socketId: string
        socketPid: string
        rooms: string[]
    }>
}

const KEY_GLOBAL_STATE = '_sio_server_state_'
const KEY_PREFIX_CONN_STATE = '_sio_server_state_'

export class Persister {

    constructor(private readonly sioCtx: CF.DurableObjectState) {
    }

    async loadServerState(): Promise<PersistedSioServerState> {
        return await this.sioCtx.storage.get('_sio_server_state:') || {
            concreteNamespaces: [],
            clientIds: []
        }
    }

    async loadClientStates(clientIds: string[]): Promise<Map<string, PersistedSioClientState>>{
        if (!clientIds.length) {
            return new Map()
        }
        // FIXME should prefix the key
        return await this.sioCtx.storage.get(clientIds)
    }

    onCreateNamespace(concreteNsp: any, parentNsp?: any) {

    }

    persistParentNamespace(pns) {
        // not persisted: user is expected to always
    }
    persistConcreteNamespace(ns) {
        ns.sockets //
    }

    persistSioClient(client) {
        client.sockets // sioSocket.id => Socket
        client.nsps // nsp.name => Socket
    }

    persistSioSocket(concreteNs, socket) {
        socket.nsp // the concrete ns
        socket.client // the sio.Client
        socket.id
        socket.pid

    }

    onRemoveNamespace(concreteNsp: any, parentNsp?: any) {

    }


}
