import {Hono} from 'hono';
import type {DurableObjectNamespace} from '@cloudflare/workers-types';
import {createDebugLogger} from './utils/logger';

export interface WorkerBindings extends Record<string, unknown> {
  // engineActor: DurableObjectNamespace;
  // sioActor: DurableObjectNamespace;
    wsHandler: DurableObjectNamespace
}

const debugLogger = createDebugLogger('sio-worker:workerApp');

export const workerApp = new Hono<{Bindings: WorkerBindings}>().get(
  '/socket.io/*',
  async ctx => {
      // debugLogger('ws connection request', ctx.req.url);

      const actorId = ctx.env.wsHandler.idFromString("singleton");
      const actor = ctx.env.engineActor.get(actorId);
      const res = await actor
          .fetch('https://engineActor.internal/socket.io', ctx.req.raw);
      return new Response(res.body, res);
  }
);
