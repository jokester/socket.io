// @ts-ignore
import type {Namespace} from 'socket.io/lib/index';
// @ts-expect-error
import {Server as OrigSioServer, Socket} from 'socket.io/lib/index';
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
        for(const nsName of s.concreteNamespaces) {
            // this will rebuild the namespaces and parentNsp.children
            this.of(s)
        }

        // FIXME should be batched
        const clientStates = await this.persister.loadClientStates(s.clientIds)

        clientStates.forEach((clientState, clientId) => {
            const eioSocketStub = new EioSocketStub(clientId, clientState.engineActorId, this)
            const client = new SioClient(this, eioSocketStub)
            clientState.namespaces.forEach((nspState, nspName) => {
                const nsp = this._nsps.get(nspName)
                if (!nsp) {
                    debugLogger('WARNING nsp was referenced but not recreated', nspName)
                    return
                }

                const socket = new Socket(nsp, client, {}, {
                    pid: nspState.socketPid,
                    id: nspState.socketId,
                    rooms: nspState.rooms,
                })
            })

        })
    }

    of(
        name: unknown,
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
    onEioConnection(conn: EioSocketStub) {
        if (this.connStubs.has(conn.eioSocketId)) {
            console.warn(new Error(`eio socket ${conn.eioSocketId} already exists`))
            return
        }
        this.connStubs.set(conn.eioSocketId, conn)
        new SioClient(this, conn)
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
