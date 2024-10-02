import type * as CF from '@cloudflare/workers-types';
import debugModule from "debug";
import {EioSocketStub} from "./EioSocketStub";
import type * as sio from 'socket.io'
import {SioClient} from "./Client";
const debugLogger = debugModule('sio-serverless:sio:Persister');

interface PersistedSioServerState1 {
    concreteNamespaces: string[]
}

interface PersistedSioServerState2 {
    clientIds: Set<string> // equal to eioSocket.id
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

const DEBUG_KEY_PREFIX = '' // '_00002_'
const KEY_GLOBAL_STATE_NAMESPACES = `${DEBUG_KEY_PREFIX}_namespaces`
const KEY_GLOBAL_STATE_CLIENTS = `${DEBUG_KEY_PREFIX}_clients`
const KEY_CLIENT_STATE_PREFIX = `${DEBUG_KEY_PREFIX}_client_`

export class Persister {

    constructor(private readonly sioCtx: CF.DurableObjectState) {
    }

    async DEV_resetState() {
        await this.sioCtx.storage.deleteAll();
    }

    async loadServerState(): Promise<PersistedSioServerState1 & PersistedSioServerState2> {
        // await this.DEV_resetState();
        const s1 = await this.sioCtx.storage.get<PersistedSioServerState1>(KEY_GLOBAL_STATE_NAMESPACES)
        const s2 = await this.sioCtx.storage.get<PersistedSioServerState2>(KEY_GLOBAL_STATE_CLIENTS)

        const loaded = {
            concreteNamespaces: s1?.concreteNamespaces ?? [],
            clientIds: new Set(s2?.clientIds ?? [])
        }
        debugLogger('loadServerState', loaded)
        return loaded
    }

    async loadClientStates(clientIds: Set<string>): Promise<Map<string, PersistedSioClientState>>{
        if (!clientIds.size) {
            return new Map()
        }
        const realKeys = [...clientIds].map(id => `${KEY_CLIENT_STATE_PREFIX}${id}`)
        // FIXME should prefix the key
        const loaded = await this.sioCtx.storage.get<PersistedSioClientState>(realKeys)
        // debugLogger('loadClientStates raw', loaded)
        const keyRemoved = new Map<string, PersistedSioClientState>()
        for (const [k, v] of loaded) {
            keyRemoved.set(k.slice(KEY_CLIENT_STATE_PREFIX.length), v)
        }
        debugLogger('loadClientStates', keyRemoved)
        return keyRemoved
    }

    async saveNamespaces(concreteNamespaces: string[]) {
        debugLogger('saveNamespaces', concreteNamespaces)
        const prev = await this.loadServerState()
        const updated: PersistedSioServerState1 = {
            ...prev,
            concreteNamespaces,
        }
        await this.sioCtx.storage.put({[KEY_GLOBAL_STATE_NAMESPACES]: updated})
    }

    async onNewClient(stub: EioSocketStub) {
        debugLogger('onNewClient', stub.eioSocketId)
        const clientId = stub.eioSocketId;
        await this.replaceGlobalState<PersistedSioServerState2>(KEY_GLOBAL_STATE_CLIENTS, prev => ({clientIds: prev?.clientIds?  [...prev?.clientIds, clientId] : [clientId]}) )
        await this.replaceClientState(clientId, prev => ({clientId, engineActorId: stub.ownerActor, namespaces: new Map()}))
    }

    async onRemoveClient(stub: EioSocketStub) {
        debugLogger('onRemoveClient', stub.eioSocketId)
        await this.replaceGlobalState<PersistedSioServerState2>(KEY_GLOBAL_STATE_CLIENTS, prev => {
            prev?.clientIds.delete(stub.eioSocketId)
            return prev
        })
    }

    async onNewSocket(socket: sio.Socket) {
        const clientId = (socket.client as SioClient).conn.eioSocketId
        debugLogger('onNewSocket', clientId, socket.nsp.name)

        await this.replaceClientState(clientId, prev => {
            prev!.namespaces.set(
                socket.nsp.name,
                {
                    socketId: socket.id,
                    socketPid: socket.pid,
                    rooms: []
                }
            )
            return prev!
        })

    }

    async replaceGlobalState<T>(key: string, f: (prev: T | undefined) => T) {
        const prev = await this.sioCtx.storage.get<T>(key)
        debugLogger('replaceGlobalState prev', key, prev)
        const updated = f(prev)
        await this.sioCtx.storage.put({[key]: updated})
        debugLogger('replaceGlobalState updated', key, updated)
    }

    async replaceClientState(clientId: string, f: (prev: PersistedSioClientState | undefined) => PersistedSioClientState) {
        const prev = await this.sioCtx.storage.get<PersistedSioClientState>(`${KEY_CLIENT_STATE_PREFIX}${clientId}`)
        debugLogger('replaceClientState prev', clientId, prev)
        const updated = f(prev)
        await this.sioCtx.storage.put({[`${KEY_CLIENT_STATE_PREFIX}${clientId}`]: updated})
        debugLogger('replaceClientState updated', clientId, updated)
    }


    async persistSioClient$$$(client) {
        client.sockets // sioSocket.id => Socket
        client.nsps // nsp.name => Socket
    }

    persistSioSocket$$$(concreteNs, socket) {
        socket.nsp // the concrete ns
        socket.client // the sio.Client
        socket.id
        socket.pid

    }

    onRemoveNamespace(concreteNsp: any, parentNsp?: any) {

    }


}
