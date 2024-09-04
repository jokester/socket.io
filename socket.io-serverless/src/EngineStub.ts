import {
  type WsWebSocket,
  WebSocket as _EioWebSocket,
} from 'engine.io/lib/transports/websocket';
import {Socket as _EioSocket} from 'engine.io/lib/socket';
import type * as eio from 'engine.io/lib/engine.io';
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

export function createEioSocket(
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
): IncomingMessage & {websocket: WsWebSocket} {
  return {
    // @ts-expect-error
    _query: {
      sid: '',
      EIO: '4',
    },
    websocket,
  };
}
