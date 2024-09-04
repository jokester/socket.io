import { Polling as XHR } from "./polling";
import { JSONP } from "./polling-jsonp";
import { WebSocket } from "./websocket";
import { WebTransport } from "./webtransport";
import { EngineRequest } from "../transport";

export { Polling as XHR } from "./polling";
export { JSONP } from "./polling-jsonp";
export { WebSocket, WebTransport };

export type TransportImpl = WebSocket | WebTransport | XHR | JSONP;

const transports = {
  polling: polling as unknown as TransportConstructor,
  websocket: WebSocket as TransportConstructor,
  webtransport: WebTransport as TransportConstructor,
};

export default transports

export type TransportName = keyof typeof transports;

export interface TransportConstructor {
  new (
    req: EngineRequest,
    ...more: any[]
  ): WebSocket | WebTransport | XHR | JSONP;

  upgradesTo?: string[];
}

/**
 * Polling polymorphic constructor.
 */
function polling(req: EngineRequest) {
  if ("string" === typeof req._query.j) {
    return new JSONP(req);
  } else {
    return new XHR(req);
  }
}

polling.upgradesTo = ["websocket", "webtransport"];
