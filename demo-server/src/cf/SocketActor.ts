import type * as CF from '@cloudflare/workers-types';
import {DurableObject} from "cloudflare:workers";
import {Server as SioServer } from 'socket.io/lib/index';
import {Client as SioClient} from 'socket.io/lib/client';
import {InMemoryAdapter} from 'socket.io-adapter/lib'
import type {WorkerBindings} from "./workerApp";
import debug from 'debug'
import {lazy} from "@jokester/socket.io-serverless/src/utils/lazy";
import {EventEmitter} from "events";

const debugLogger = debug('sio-serverless:SocketActor');

declare const self: CF.ServiceWorkerGlobalScope;
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

    private readonly sioServer = lazy(() => new CustomSioServer())
}

interface CustomSioServerDelegate {

}

/**
 * Serializable state for CustomSioServer to continue working after hibernation
 */
interface HydratedServerState {
    concreteNamespaces: string[]
    connections: Map</* eio.socketId */string, {actorAddr: CF.DurableObjectId, namespaces: string[], rooms: string[]}>


}

class CustomSioServer extends SioServer {
    private readonly connStubs = new Map<string, EioSocketStub>()

    constructor(dehydrate?: HydratedServerState) {
        debugLogger('CustomSioServer#constructor', dehydrate)
        super(undefined, {
            transports: ['websocket'],
            allowEIO3: false,
            serveClient: false,
            connectionStateRecovery: null,
            cleanupEmptyChildNamespaces: true,
            // adapter: TODO,
        }, );
        this.restoreState(dehydrate)
    }

    /**
     * replaces bind / initEngine / attach /
     * @param s
     * @private
     */
    private restoreState(s?: HydratedServerState) {
        if (s) {
            const f = new Map<string, any>()
            for (const [socketId, {actorAddr}] of s.connections) {
                const stubConn = new EioSocketStub(socketId, actorAddr, this)
                this.connStubs.set(socketId, stubConn)
                new CustomSioClient(this, stubConn)
                f.set(socketId, stubConn)
            }
            // TODO: more
        }

    }

    /**
     * replaces onconnection(conn: eio.Socket)
     */
    onEioConnection(conn: EioSocketStub) {
        if (this.connStubs.has(conn.eioSocketId)) {
            throw new Error(`eio socket ${conn.eioSocketId} already exists`)
        }
        this.connStubs.set(conn.eioSocketId, conn)
        new CustomSioClient(this, conn)
    }

    onEioData(eioSocketId: string, data: any) {
        this.connStubs.get(eioSocketId)?.emit('data', data)
    }

    onEioClose(eioSocketId: string, code: number, reason: string) {
        this.connStubs.get(eioSocketId)?.emit('close', reason, `code: ${code}`)
    }

    onEioError(eioSocketId: string, error: any) {
        this.connStubs.get(eioSocketId)?.emit('error', error)
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
        return {}
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
    }

    /** rewrites SioClient#setup() */
    setup() {
        // @ts-expect-error calling private method
        this.decoder.on("decoded", packet => this.ondecoded(packet));
        // @ts-expect-error calling private method
        this.conn.on("data", data => this.ondata(data));
        // @ts-expect-error calling private method
        this.conn.on("error", error => this.onerror(error));
        // @ts-expect-error calling private method
        this.conn.on("close", (reason, desc) => this.onclose(reason, desc));
        // NOT supported: connectTimeout
    }

}

class CustomSioAdapter extends InMemoryAdapter {

}
