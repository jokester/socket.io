import {
  type WsWebSocket,
  WebSocket as _EioWebSocket,
} from 'engine.io/lib/transports/websocket';
import {Socket as _EioSocket} from 'engine.io/lib/socket';
import type * as eio from 'engine.io';
import type * as CF from '@cloudflare/workers-types';
import {EventEmitter} from 'events';
import {createDebugLogger} from './utils/logger';
import type {IncomingMessage} from 'node:http';

const debugLogger = createDebugLogger('sio-worker:EngineStubs');

export class EioWebSocket extends _EioWebSocket {
  get _socket(): WsWebSocket {
    // @ts-expect-error
    return this.socket;
  }
}

export class EioSocket extends _EioSocket {
  constructor(sid: string, readonly _socket: EioWebSocket) {
    super(sid, createStubEioServer(), _socket, null, 4);
  }
  onCfClose() {
    (this.transport as EioWebSocket)._socket.emit('close');
  }
  onCfMessage(msg: string | Buffer) {
    const msgStr = typeof msg === 'string' ? msg : msg.toString();
    (this.transport as EioWebSocket)._socket.emit('message', msgStr);
  }
  onCfError(msg: string, desc?: string) {
    (this.transport as EioWebSocket)._socket.emit('error', new Error(msg));
  }
}

