// @ts-ignore
import type {Namespace, Socket} from 'socket.io/lib/index';
// @ts-expect-error
import {Server as OrigSioServer} from 'socket.io/lib/index';
import type * as CF from "@cloudflare/workers-types";
import debugModule from "debug";
import {EioSocketStub} from "./EioSocketStub";
import {SioClient} from "./Client";
import {EngineActorBase} from "../eio/EngineActorBase";

const debugLogger = debugModule('sio-serverless:sio:Server');

/**
 * Serializable state for CustomSioServer to rebuild state working after hibernation
 */
export interface ConnectionState {
    connections: Map</* eio.socketId */string,
        {
            actorAddr: CF.DurableObjectId, namespaces: Map</* concreteNsp.name */string,
                { id: string, rooms: string[], missedPackets: [], data: {} }>
        }>
}

export class SioServer extends OrigSioServer {
    private readonly connStubs = new Map<string, EioSocketStub>()

    constructor(private readonly socketActorCtx: CF.DurableObjectState, private readonly engineActorNs: CF.DurableObjectNamespace<EngineActorBase>,
                private readonly onStateChange: (eioSocketId: string, x: ConnectionState) => void,
                ) {
        debugLogger('CustomSioServer#constructor')
        super(undefined, {
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

    /**
     * replaces bind / initEngine / attach /
     * @param s
     * @private
     */
    private restoreState(s?: HydratedServerState) {
        if (s) {
            const concreteNamespaces = new Map<string, Namespace>()
            for (const n of s.concreteNamespaces) {
                const nsp = new Namespace(this, n)
                concreteNamespaces.set(n, nsp)
            }
            for (const [socketId, {actorAddr, namespaces}] of s.connections) {
                const stubConn = this.createEioSocketStub(socketId, actorAddr)
                this.connStubs.set(socketId, stubConn)
                const client = new CustomSioClient(this, stubConn)
                for (const [ns, previousSession] of namespaces) {
                    const nsp = concreteNamespaces.get(ns)
                    if (!nsp) {
                        throw new Error(`namespace ${ns} not found`)
                    }
                    const socket = new Socket(nsp, client, {}, previousSession)
                }
            }
            // TODO: more
        }
    }

    createEioSocketStub(socketId: string, actorAddr: CF.DurableObjectId): EioSocketStub {
        return new EioSocketStub(socketId, actorAddr, this)
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
