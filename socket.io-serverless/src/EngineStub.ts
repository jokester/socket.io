import {
  type WsWebSocket,
  WebSocket as _EioWebSocket,
  // @ts-ignore
} from 'engine.io/lib/transports/websocket';
// @ts-ignore
// @ts-ignore
import type * as eio from 'engine.io';
import type * as CF from '@cloudflare/workers-types';
import {EventEmitter} from 'events';
import {createDebugLogger} from './utils/logger';
import type {IncomingMessage} from 'node:http';

const debugLogger = createDebugLogger('sio-worker:EngineStubs');

export class EioWebSocket extends _EioWebSocket {
}

