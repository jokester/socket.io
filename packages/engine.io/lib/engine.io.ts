import { createServer, Server as HttpServer } from "http";
import { Server, AttachOptions, ServerOptions } from "./server";
import transports from "./transports/index";
import * as parser from "engine.io-parser";

export { Server, transports, listen, attach, parser };
export type { AttachOptions, ServerOptions, BaseServer } from "./server";
export { uServer } from "./userver";
export { Socket } from "./socket";
export { Transport } from "./transport";
export const protocol = parser.protocol;

/**
 * Creates an http.Server exclusively used for WS upgrades, and start listening.
 *
 * @param port
 * @param options
 * @param listeningListener passed to http.Server.listen()
 * @return engine.io server
 */

function listen(port: number, options?: AttachOptions & ServerOptions, listeningListener?: () => void): Server {
  if ("function" === typeof options) {
    listeningListener = options;
    options = {};
  }

  const server = createServer(function (req, res) {
    res.writeHead(501);
    res.end("Not Implemented");
  });

  // create engine server
  const engine = attach(server, options);
  engine.httpServer = server;

  server.listen(port, listeningListener);

  return engine;
}

/**
 * Captures upgrade requests for a http.Server.
 *
 * @param server
 * @param options
 * @return engine.io server
 * @api public
 */

function attach(server: HttpServer, options: AttachOptions & ServerOptions): Server {
  const engine = new Server(options);
  engine.attach(server, options);
  return engine;
}
