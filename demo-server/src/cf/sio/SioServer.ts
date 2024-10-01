// @ts-ignore
import type {Namespace} from 'socket.io/lib/index';
// @ts-expect-error
import {Server as OrigSioServer, Socket} from 'socket.io';
import type * as CF from "@cloudflare/workers-types";
import debugModule from "debug";
import {EioSocketStub} from "./EioSocketStub";
import {SioClient} from "./Client";
import {EngineActorBase} from "../eio/EngineActorBase";
import type * as sio from 'socket.io'
import {Persister} from "./Persister";

const debugLogger = debugModule('sio-serverless:sio:Server');

export class SioServer extends OrigSioServer {
    private readonly connStubs = new Map<string, EioSocketStub>()

    constructor(
        options: Partial<sio.ServerOptions>,
        private readonly socketActorCtx: CF.DurableObjectState, private readonly engineActorNs: CF.DurableObjectNamespace<EngineActorBase>,
                private readonly persister: Persister
                ) {
        debugLogger('CustomSioServer#constructor')
        super(undefined, {
            ...options,
            transports: ['websocket'],
            allowEIO3: false,
            serveClient: false,
            connectionStateRecovery: null,
            cleanupEmptyChildNamespaces: true,
            // adapter: TODO,
        },);
    }

    _sendEioPacket(stub: EioSocketStub, msg: string | Buffer) {
        /**
         * NOTE the ownerActor received from RPC may be unusable as a DO id
         */
        const destId = this.engineActorNs.idFromString(stub.ownerActor.toString())
        debugLogger('CustomSioServer#_sendEioPacket', destId, stub.eioSocketId, msg)
        const engineActorStub = this.engineActorNs.get(destId)
        engineActorStub.sendMessage(stub.eioSocketId, msg).then(
            () => {
                debugLogger('sent', stub.eioSocketId, msg)
            },
            e => {
                debugLogger('failed to send', stub.eioSocketId, msg, e)
            })
    }

    async restoreState() {
        const s = await this.persister.loadServerState()
        debugLogger('restore server state', s)
        const recoveredNsps = new Map<string, Namespace>()
        for(const nsName of s.concreteNamespaces) {
            if (nsName == '/') {
                // root ns is created by default
                continue
            }
            // this will rebuild the namespaces, and (when name matches) add them to parentNsp.children
            debugLogger('recreating namespace', nsName)
            recoveredNsps.set(nsName, this.of(nsName))
        }

        // FIXME should be batched
        const clientStates = await this.persister.loadClientStates(s.clientIds)

        clientStates.forEach((clientState, clientId) => {
            const conn = new EioSocketStub(clientId, clientState.engineActorId, this)
            this.connStubs.set(conn.eioSocketId, conn)
            const client = new SioClient(this, conn)
            clientState.namespaces.forEach((nspState, nspName) => {
                debugLogger('recreate sio.Socket', clientId, nspState)
                const nsp = recoveredNsps.get(nspName)

                if (!nsp) {
                    debugLogger('WARNING nsp was referenced but not recreated', nspName)
                    return
                }

                // replay Namespace#_add()
                const socket = new Socket(nsp, client, {}, {
                    pid: nspState.socketPid,
                    id: nspState.socketId,
                    rooms: nspState.rooms,
                    missedPackets: [],
                })

                // replay: Namespace#_doConnect

                // replay Socket#_onconnect
                nsp.sockets.set(socket.id, socket)
                socket.connected = true
                socket.join(socket.id)

                // replay: Client#doConnect
                client.sockets.set(socket.id, socket)
                client.nsps.set(nsp.name, socket)

                debugLogger('recreated sio.Socket', socket.id, socket.pid)
            })
            debugLogger('recreated SioClient', client.conn.eioSocketId, Array.from(client.nsps.keys()))
        })

    }

    startPersisting() {
        for(const nsp of this._nsps.values()) {
            nsp.on('connection', (socket: Socket) => this.persister.onNewSocket(socket))
        }
        /**
         * state changes from now on get persisted
         */
        this.on('new_namespace', nsp => {
            const nspNames = [...this._nsps.keys()]
            this.persister.saveNamespaces(nspNames)
            nsp.on('connection', (socket: Socket) => this.persister.onNewSocket(socket))
        })

        // NOTE SioClient creation will only be triggered later
    }

    of(
        name: string | RegExp | Function,
        fn?: (
            socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
        ) => void
    ): Namespace {
        if (typeof name === 'function') {
            throw new TypeError('Defining parent namespace with function is not supported')
        }
        return super.of(name, fn)
    }
    /**
     * replaces onconnection(conn: eio.Socket)
     */
    async onEioConnection(conn: EioSocketStub): Promise<void> {
        if (this.connStubs.has(conn.eioSocketId)) {
            console.warn(new Error(`eio socket ${conn.eioSocketId} already exists`))
            return
        }
        this.connStubs.set(conn.eioSocketId, conn)
        new SioClient(this, conn)
        await this.persister.onNewClient(conn)
    }

    onEioData(eioSocketId: string, data: any) {
        if (!this.connStubs.has(eioSocketId)) {
            console.warn(new Error(`eio socket ${eioSocketId} not found`))
            return
        }
        this.connStubs.get(eioSocketId)!.emit('data', data)
    }

    onEioClose(eioSocketId: string, code: number, reason: string) {
        if (!this.connStubs.has(eioSocketId)) {
            console.warn(new Error(`eio socket ${eioSocketId} not found`))
            return
        }
        this.connStubs.get(eioSocketId)!.emit('close', reason, `code: ${code}`)
    }

    onEioError(eioSocketId: string, error: any) {
        if (!this.connStubs.has(eioSocketId)) {
            throw new Error(`eio socket ${eioSocketId} not found`)
        }
        this.connStubs.get(eioSocketId)!.emit('error', error)
    }

    closeConn(stub: EioSocketStub) {

    }

}
