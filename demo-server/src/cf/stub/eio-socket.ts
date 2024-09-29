import {EventEmitter} from "events";
import debugModule   from "debug";
import {
    type WsWebSocket,
    // @ts-ignore
} from 'engine.io/lib/transports/websocket';
import {CustomEioWebsocketTransport} from "./eio-ws-transport";
import {SocketActor} from "../SocketActor";
import {EngineActor} from "../EngineActor";
// @ts-ignore
import {Socket as EioSocket} from 'engine.io/lib/socket';

const debugLogger = debugModule('engine.io:CustomEioSocket');

/**
 * A stub that should still emit the following events (used by sio.Client)
 * - data
 * - error
 * - close
 */
export class CustomEioSocket extends EioSocket {
    static create(eioActor: EngineActor, sid: string, transport: CustomEioWebsocketTransport): CustomEioSocket {
        return new CustomEioSocket(eioActor, sid, transport);
    }

    private _setupDone = false;

    constructor(private readonly eioActor: EngineActor, private readonly _sid: string, readonly _transport: CustomEioWebsocketTransport) {
        super(_sid, createStubEioServer(), _transport, null, 4);
    }

    get _socket(): WsWebSocket {
        // @ts-expect-error
        return this.socket;
    }
    setupOutgoingEvents() {
        if (this._setupDone) {
            return
        }
        debugLogger('setup outgoing events', this._sid)
        const eioAddr = this.eioActor._ctx.id;
        const destId = this.eioActor._env.socketActor.idFromName('singleton')
        // @ts-ignore
        const destStub: SocketActor = this.eioActor._env.socketActor.get(destId)

        // TODO: close/error events may should be short circuited
        this.on('data', data => destStub.onEioSocketData(eioAddr, this._sid, data));
        this.on('close', (code, reason) => destStub.onEioSocketClose(eioAddr, this._sid, code, reason));
        this.on('error', error => destStub.onEioSocketError(eioAddr, this._sid, error));
        destStub.onEioSocketConnection(eioAddr, this._sid)

        this._setupDone = true
    }

    schedulePing() {
        // rewrite to work with CF worker 'timer' polyfill
        // (this removes ping timeout detection on server side)
        this.pingTimeoutTimer = {
            refresh() {}
        }
        this.pingIntervalTimer = {
            refresh() {}
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

    onCfClose() {
        (this.transport as CustomEioWebsocketTransport)._socket.emit('close');
    }

    onCfMessage(msg: string | Buffer) {
        debugLogger('onCfMessage', this.sid, msg);
        const msgStr = typeof msg === 'string' ? msg : msg.toString();
        (this.transport as CustomEioWebsocketTransport)._socket.emit('message', msgStr);
    }

    onCfError(msg: string, desc?: string) {
        (this.transport as CustomEioWebsocketTransport)._socket.emit('error', new Error(msg));
    }
}

function createStubEioServer() {
    const server = new EventEmitter();
    Object.assign(server, {
        /**
         * NOTE the message containing this is not sent to client
         * but this may do no harm
         */
        opts: {
            pingInterval: 10_000,
            pingTimeout: 20_000,
        } as eio.ServerOptions,
        upgrades: () => [],
    });
    return server;
}

