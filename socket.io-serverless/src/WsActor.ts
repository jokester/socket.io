import type * as CF from '@cloudflare/workers-types';
import {WorkerBindings} from './workerApp';
import {lazy} from './utils/lazy';
import {Hono} from 'hono';
import {wait} from '@jokester/ts-commonutil/lib/concurrency/timing';

declare const self: CF.ServiceWorkerGlobalScope;
const {Response, fetch, addEventListener, WebSocketPair} = self;

/**
 * A basic WS + Hibernation handler
 * based on https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/
 */
export class WsActor implements CF.DurableObject {
  constructor(
    private state: CF.DurableObjectState,
    private readonly env: WorkerBindings
  ) {}

  readonly honoApp = lazy(() =>
    new Hono<WorkerBindings>().get('/*', async ctx => {
      if (ctx.req.header('Upgrade') !== 'websocket') {
        return new Response(null, {
          status: 426,
          statusText: 'Not a Upgrade request',
        });
      }

      const {0: client, 1: server} = new WebSocketPair();

      // accepts WS connection (max 32k conn per DO instance)
      this.state.acceptWebSocket(server);
      // DO NOT call this, this is incompatible with WebSocket Hibernation
      // server.accept();

      setTimeout(async () => {
        for (let i = 0; i < 3; i++) {
          server.send(
            JSON.stringify({message: 'server sent', serverTime: Date.now()})
          );
          await wait(1e3);
        }
        server.close(1002, 'server close');
      });

      return new Response(null, {status: 101, webSocket: client});
    })
  );

  fetch(req: CF.Request): CF.Response | Promise<CF.Response> {
    const {value: app} = this.honoApp;
    return app.fetch(req as any as Request, this.env) as any as CF.Response;
  }

  webSocketClose(
    ws: CF.WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): void | Promise<void> {
    console.log('websocketClose', {
      ws,
      code,
      reason,
      wasClean,
    });
  }

  webSocketMessage(
    ws: CF.WebSocket,
    message: string | ArrayBuffer
  ): void | Promise<void> {
    if (ws.readyState !== self.WebSocket.OPEN) {
      return;
    }
    ws.send(
      JSON.stringify({
        ...JSON.parse(message.toString()),
        serverTime: Date.now(),
      })
    );
  }

  webSocketError(ws: CF.WebSocket, error: unknown): void | Promise<void> {
    console.log('websocket error', error);
  }
}
