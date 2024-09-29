import type * as CF from '@cloudflare/workers-types';
// @ts-ignore
import type * as eio from 'engine.io/lib/engine.io';
import {EventEmitter} from "events";
import debugModule from "debug";
import {
    type WsWebSocket,
    // @ts-ignore
} from 'engine.io/lib/transports/websocket';
import {CustomEioWebsocketTransport} from "./eio-ws-transport";
import type {SocketActor} from "../SocketActor";
// @ts-ignore
import {Socket as EioSocket} from 'engine.io/lib/socket';
import {EioSocketState} from "../engine-delegate";

const debugLogger = debugModule('engine.io:CustomEioSocket');

/**
 * A stub that should still emit the following events (used by sio.Client)
 * - data
 * - error
 * - close
 */
export class CustomEioSocket extends EioSocket {
    constructor(private readonly socketState: EioSocketState, private readonly _transport: CustomEioWebsocketTransport) {
        super(socketState.eioSocketId, createStubEioServer(), _transport, null, 4);
    }

    get _socket(): WsWebSocket {
        // @ts-expect-error
        return this.socket;
    }

    async setupOutgoingEvents(
        socketState: EioSocketState,
        ) {
        debugLogger('setup outgoing events', socketState.eioSocketId)
        const eioAddr = socketState.eioActorId

        // start forwarding data/close/error events to sioActorStub
        this.on('data', data => socketState.socketActorStub.onEioSocketData(eioAddr, socketState.eioSocketId, data));
        this.on('close', (code, reason) => socketState.socketActorStub.onEioSocketClose(eioAddr, socketState.eioSocketId, code, reason));
        this.on('error', error => socketState.socketActorStub.onEioSocketError(eioAddr, socketState.eioSocketId, error));
        // TODO: subscribe to close/error inside SioActor code
    }

    schedulePing() {
        // rewrite to workaround incompatible 'timer' polyfill in CF worker
        // (this also removes server-initiated ping timeout detection in protocol v4)
        this.pingTimeoutTimer = {
            refresh() {
            }
        }
        this.pingIntervalTimer = {
            refresh() {
            }
        }
    }

    resetPingTimeout() {
        // emptied to fit `schedulePing` change
    }

    onPingAlarmTick() {
        // instead of setTimeout, trigger server-sent ping with alarm
        // TODO: connect alarm
        this.sendPacket('ping')
    }

    onCfClose(code: number, reason: string, wasClean: boolean) {
        // FIXME reason/wasClean should be used someway
        this._transport._socket.emit('close'); // this will bubble up and call SocketActor#onEioSocketClose
    }

    onCfMessage(msg: string | Buffer) {
        debugLogger('onCfMessage', this.socketState.eioSocketId, msg);
        const msgStr = typeof msg === 'string' ? msg : msg.toString();
        this._transport._socket.emit('message', msgStr); // this will bubble up and call SocketActor#onEioSocketData
    }

    onCfError(msg: string, desc?: string) {
        debugLogger('onCfError', this.socketState.eioSocketId, msg);
        this._transport._socket.emit('error', new Error(msg)); // this will bubble up and call SocketActor#onEioSocketError
    }
}

function createStubEioServer() {
    const server = new EventEmitter();
    Object.assign(server, {
        opts: {
            pingInterval: 10_000,
            pingTimeout: 20_000,
        } as eio.ServerOptions,
        upgrades: () => [],
    });
    return server;
}

