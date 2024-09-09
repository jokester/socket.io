import type * as CF from '@cloudflare/workers-types';
import type {WorkerBindings} from "./workerApp";
import {lazy} from "@jokester/socket.io-serverless/src/utils/lazy";
import {Hono} from "hono";
import {createDebugLogger} from "@jokester/socket.io-serverless/src/utils/logger";
import type * as eio from 'engine.io'
import {WebSocket as WebSocketTransport} from 'engine.io/lib/transports/websocket'
import type {WebSocket as WsWebSocket} from 'ws'
import {EventEmitter} from "events";
import type {IncomingMessage} from "http";
import {EioSocket, EioWebSocket} from "@jokester/socket.io-serverless/src/EngineStub";

const debugLogger = createDebugLogger('sio-worker:EngineActor');
declare const self: CF.ServiceWorkerGlobalScope;

/**
 * Works in place of a engine.io Server
 * - accepts incoming WebSocket connection
 * - emit eio.Socket
 */
export class EngineActor implements CF.DurableObject {
    constructor(
        readonly state: CF.DurableObjectState,
        readonly env: WorkerBindings
    ) {}

    fetch(request: Request): Response | Promise<Response> {
        return this.honoApp.value.fetch(request)
    }

    private readonly honoApp = lazy(() => createHandler(this))
}

function createHandler(actor: EngineActor) {

    return new Hono()

        .get('/socket.io/*', async ctx => {
            if (ctx.req.header('Upgrade') !== 'websocket') {
                return new Response(null, {
                    status: 426,
                    statusText: 'Not a Upgrade request',
                });
            }

            debugLogger('new ws connection', ctx.req.url);
            const {0: clientSocket, 1: serverSocket} = new self.WebSocketPair();
            // TODO: if req contains a Engine.io sid, should query engine.io server to follow the protocol

            const sid = this.eioSid;
            /**
             * TODO remove tags
             */
            const tags = [`sid:${sid}`];
            actor.state.acceptWebSocket(serverSocket, tags);
            const socket = createEioSocket(sid, serverSocket);

            await this.onEioSocket(sid, socket);
            this._socket.fulfill(socket);
            return new self.Response(null, {status: 101, webSocket: clientSocket});
        })
}

function createEioSocket(
    sid: string,
    cfSocket: CF.WebSocket
): EioSocket {
    const stubWebSocket = createStubWebSocket(cfSocket);
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
        close: cfWebSocket.close.bind(cfWebSocket),
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

