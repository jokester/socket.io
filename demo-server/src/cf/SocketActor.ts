import type * as CF from '@cloudflare/workers-types';
// @ts-expect-error
import {DurableObject} from "cloudflare:workers";
// @ts-expect-error
import {Server as SioServer, Namespace, Socket} from 'socket.io/lib/index';
// @ts-expect-error
import {Client as SioClient} from 'socket.io/lib/client';
// @ts-expect-error
import {InMemoryAdapter} from 'socket.io-adapter/lib'
import type {WorkerBindings} from "./workerApp";
import debug from 'debug'
import {lazy} from "@jokester/socket.io-serverless/src/utils/lazy";
import {EventEmitter} from "events";
import * as forwardEverything from "../app/forward-everything";

const debugLogger = debug('sio-serverless:SocketActor');

export class SocketActor extends DurableObject<WorkerBindings> implements CF.DurableObject {

    fetch(req: CF.Request) {
        throw new Error('Method not implemented.');
    }

    onEioSocketConnection(actorAddr: CF.DurableObjectId, socketId: string) {
        debugLogger('SocketActor#onEioSocketConnection', actorAddr, socketId)
        const stubConn = new EioSocketStub(socketId, actorAddr, this.sioServer.value)
        this.sioServer.value.onEioConnection(stubConn)
    }

    onEioSocketData(actorAddr: CF.DurableObjectId, socketId: string, data: unknown) {
        debugLogger('SocketActor#onEioSocketData', actorAddr, socketId, data)
        // throw new Error('Method not implemented.');
        this.sioServer.value.onEioData(socketId, data)
    }

    onEioSocketClose(actorAddr: CF.DurableObjectId, socketId: string, code: number, reason: string) {
        debugLogger('SocketActor#onEioSocketClose', actorAddr, socketId, code, reason)
        this.sioServer.value.onEioClose(socketId, code, reason)
    }

    onEioSocketError(actorAddr: CF.DurableObjectId, socketId: string, error: unknown) {
        debugLogger('SocketActor#onEioSocketError', actorAddr, socketId, error)
        this.sioServer.value.onEioError(socketId, error)
    }

    get _env(): WorkerBindings {
        // @ts-ignore
        return this.env as WorkerBindings
    }

    get _ctx(): CF.DurableObjectState {
        // @ts-ignore
        return this.ctx
    }

    private readonly sioServer = lazy(() => {
        const s = new CustomSioServer(this._ctx, this._env);
        s.of(forwardEverything.parentNamespace)
            .on('connection', socket => forwardEverything.onConnection(socket));
        return s
    })
}

interface CustomSioServerDelegate {
    setup(server: CustomSioServer): void
}

/**
 * Serializable state for CustomSioServer to continue working after hibernation
 */
interface HydratedServerState {
    concreteNamespaces: string[]
    connections: Map</* eio.socketId */string,
        {
            actorAddr: CF.DurableObjectId, namespaces: Map</* concreteNsp.name */string,
                { id: string, rooms: string[], missedPackets: [], data: {} }>
        }>
}

class CustomSioServer extends SioServer {
    private readonly connStubs = new Map<string, EioSocketStub>()

    constructor(private readonly socketActorCtx: CF.DurableObjectState, private readonly socketActorEnv: WorkerBindings, dehydrate?: HydratedServerState,) {
        debugLogger('CustomSioServer#constructor', dehydrate)
        super(undefined, {
            transports: ['websocket'],
            allowEIO3: false,
            serveClient: false,
            connectionStateRecovery: null,
            cleanupEmptyChildNamespaces: true,
            // adapter: TODO,
        },);
        this.restoreState(dehydrate)
    }

    _sendEioPacket(stub: EioSocketStub, msg: string | Buffer) {
        /**
         * NOTE the ownerActor received from RPC may be unusable as a DO id
         */
        const destId = this.socketActorEnv.engineActor.idFromString(stub.ownerActor.toString())
        debugLogger('CustomSioServer#_sendEioPacket', destId, stub.eioSocketId, msg)
        const engineActorStub = this.socketActorEnv.engineActor.get(destId)
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
        new CustomSioClient(this, conn)
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

    extractState(): HydratedServerState {
        throw new Error('Method not implemented.');
    }

}

/**
 * replaces eio.Socket
 */
class EioSocketStub extends EventEmitter {
    constructor(readonly eioSocketId: string, readonly ownerActor: CF.DurableObjectId, readonly server: CustomSioServer) {
        super()
    }

    get request(): {} {
        /**
         * queried by
         * sio.Socket#buildHandshake()
         */
        return {
            remoteAddress: 'unknown',
            headers: {},
            connection: {
                encrypted: true,
            },
            url: `https://localhost:5173/dummy`

        }
    }

    get protocol() {
        return 4
    }

    get readyState(): string {
        return 'open'
    }

    get transport() {
        return {
            writable: true
        }
    }

    write(packet: string | Buffer, opts: unknown) {
        debugLogger('EioSocketStub#write', packet, opts)
        this.server._sendEioPacket(this, packet)
    }

    close() {
        this.server.closeConn(this)
    }

}

/**
 * Not supported: connectTimeout
 */
class CustomSioClient extends SioClient {
    constructor(private readonly server: CustomSioServer, private readonly conn: EioSocketStub) {
        super(server, conn);
        debugLogger('CustomSioClient#constructor', conn.eioSocketId)
    }

    /** rewrites SioClient#setup() */
    setup() {
        this.decoder.on("decoded", packet => {
            debugLogger('CustomSioClient#ondecoded', packet)
            // @ts-expect-error calling private method
            this.ondecoded(packet);
        });
        this.conn.on("data", data => {
            debugLogger('CustomSioClient#ondata', data)
            // @ts-expect-error calling private method
            this.ondata(data);
        });
        this.conn.on("error", error => {
            debugLogger('CustomSioClient#onerror', error)
            // @ts-expect-error calling private method
            this.onerror(error);
        });
        this.conn.on("close", (reason, desc) => {
            debugLogger('CustomSioClient#onclose', reason, desc)
            // @ts-expect-error calling private method
            this.onclose(reason, desc);
        });
        // NOT supported: connectTimeout
    }

}

