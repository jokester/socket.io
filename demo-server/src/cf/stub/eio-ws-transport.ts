import {StubWsWebSocket} from "./eio-ws";
import type * as CF from "@cloudflare/workers-types";
import type * as eio from 'enging.io/lib/engine.io'
// @ts-ignore
import {WebSocket as EioWebSocketTransport} from 'engine.io/lib/transports/websocket';
import debugModule from 'debug';
import type {WebSocket as WsWebSocket} from "ws";

const debugLogger = debugModule('engine.io:CustomEioWebsocketTransport');

export class CustomEioWebsocketTransport extends EioWebSocketTransport {
    constructor(readonly _stubWs: StubWsWebSocket, stubReq: eio.EngineRequest) {
        super(stubReq);
    }

    get _socket() {
        // @ts-expect-error use of private
        return this.socket;
    }

    static create(cfWebSocket: CF.WebSocket): CustomEioWebsocketTransport {
        const stubWebSocket = StubWsWebSocket.create(cfWebSocket);
        const stubReq = createStubRequest(stubWebSocket);
        const transport = new CustomEioWebsocketTransport(stubWebSocket, stubReq);
        debugLogger('sio-serverless:CustomEioWebsocketTransport created')
        return transport;
    }
}

function createStubRequest(
    websocket: WsWebSocket
): eio.EngineRequest {
    return {
        // @ts-expect-error
        _query: {
            sid: 'TODO',
            EIO: '4',
        },
        websocket,
    };
}
