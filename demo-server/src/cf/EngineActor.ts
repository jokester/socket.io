import type * as CF from '@cloudflare/workers-types';
// @ts-ignore
import type {WorkerBindings} from "./workerApp";
import {lazy} from "@jokester/socket.io-serverless/src/utils/lazy";
import {Hono} from "hono";
import {createDebugLogger} from "@jokester/socket.io-serverless/src/utils/logger";
import type * as eio from 'engine.io/lib/engine.io.ts'
import type {WebSocket as WsWebSocket} from 'ws'
import {EventEmitter} from "events";
import {DurableObject} from "cloudflare:workers";
import {WebSocket as EioWebSocketTransport} from 'engine.io/lib/transports/websocket';
import {Socket as EioSocket} from 'engine.io/lib/socket'
import {EioWebSocket} from "@jokester/socket.io-serverless/src/EngineStub";
// import {EioSocket, EioWebSocket} from "@jokester/socket.io-serverless/src/EngineStub";

const debugLogger = createDebugLogger('sio-worker:EngineActor');
declare const self: CF.ServiceWorkerGlobalScope;

/**
 * Works in place of a engine.io Server
 * - accepts incoming WebSocket connection
 * - emit eio.Socket
 */
export class EngineActor extends DurableObject implements CF.DurableObject {

    // @ts-ignore
    fetch(request: Request): Response | Promise<Response> {
        debugLogger('engineActor.fetch', this, request.url);
        return this.honoApp.value.fetch(request)
    }

    // @ts-ignore
    private readonly honoApp = lazy(() => createHandler(this, this.ctx, this.env))
}

function createHandler(actor: EngineActor, actorCtx: CF.DurableObjectState, env: WorkerBindings) {

    return new Hono()

        .get('/socket.io/*', async ctx => {
            if (ctx.req.header('Upgrade') !== 'websocket') {
                return new Response(null, {
                    status: 426,
                    statusText: 'Not a Upgrade request',
                });
            }

            const socketId = ctx.req.param('eio_sid')!

            debugLogger('new ws connection', ctx.req.url);
            const {0: clientSocket, 1: serverSocket} = new self.WebSocketPair();
            // TODO: if req contains a Engine.io sid, should query engine.io server to follow the protocol

            const sid = socketId
            /**
             * TODO remove tags
             */
            const tags = [`sid:${sid}`];
            actorCtx.acceptWebSocket(serverSocket, tags);
            const transport = CustomTransport.create(serverSocket);
            const eioSocket = CustomSocket.create(sid, transport);

            // await actor.onEioSocket(sid, transport);
            return new self.Response(null, {status: 101, webSocket: clientSocket});
        })
}

class CustomTransport extends EioWebSocketTransport {
    get _socket() {
        // @ts-expect-error use of private
        return this.socket;
    }
    static create(cfWebSocket: CF.WebSocket): CustomTransport {
        const stubWebSocket = createStubWebSocket(cfWebSocket);
        const stubReq = createStubRequest(stubWebSocket);
        return new CustomTransport(stubReq);
    }
}

export class CustomSocket extends EioSocket {
    static create(sid: string, transport: CustomTransport): CustomSocket {
        return new CustomSocket(sid, transport);
    }
    constructor(sid: string, readonly _socket: EioWebSocket) {
        super(sid, createStubEioServer(), _socket, null, 4);
    }
    onCfClose() {
        (this.transport as CustomTransport)._socket.emit('close');
    }
    onCfMessage(msg: string | Buffer) {
        const msgStr = typeof msg === 'string' ? msg : msg.toString();
        (this.transport as EioWebSocket)._socket.emit('message', msgStr);
    }
    onCfError(msg: string, desc?: string) {
        (this.transport as EioWebSocket)._socket.emit('error', new Error(msg));
    }
}

function createEioSocket(
    sid: string,
    cfSocket: CF.WebSocket
): EioSocket {
    const stubRequest = createStubRequest(stubWebSocket);
    const transport = new EioWebSocket(stubRequest);
    return new EioSocket(sid, transport);
}

function createStubWebSocket(cfWebSocket: CF.WebSocket): WsWebSocket {
    const stub: WsWebSocket = new EventEmitter() as WsWebSocket;
    Object.assign(stub, {
        _socket: {
            remoteAddress: 'FIXME: 127.0.0.1',
        },
        send(
            data: string | Buffer,
            _opts?: unknown,
            _callback?: (error?: any) => void
        ) {
            try {
                cfWebSocket.send(data);
                debugLogger('fakeWsWebSocket.send', data);
                _callback?.();
            } catch (e: any) {
                debugLogger('fakeWsWebSocket.send error', data, e);
                _callback?.(e);
            }
        },
        close: () => cfWebSocket.close()
    });
    return stub;
}

function createStubEioServer() {
    const server = new EventEmitter();
    Object.assign(server, {
        opts: {
            pingInterval: 20000,
            pingTimeout: 25000,
        } as eio.ServerOptions,
        upgrades: () => [],
    });
    return server;
}

function createStubRequest(
    websocket: WsWebSocket
): eio.EngineRequest {
    return {
        // @ts-expect-error
        _query: {
            sid: '',
            EIO: '4',
        },
        websocket,
    };
}

