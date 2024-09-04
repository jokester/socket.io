import {Hono} from 'hono';
import type {DurableObjectNamespace} from '@cloudflare/workers-types';
import {createDebugLogger} from './utils/logger';

export interface WorkerBindings extends Record<string, unknown> {
  engineActor: DurableObjectNamespace;
  sioActor: DurableObjectNamespace;
}

const debugLogger = createDebugLogger('sio-worker:workerApp');

export const workerApp = new Hono<{Bindings: WorkerBindings}>().get(
  '/socket.io/*',
  ctx => {
    // debugLogger('ws connection request', ctx.req.url);

    const actorId = ctx.env.engineActor.newUniqueId({});
    const actor = ctx.env.engineActor.get(actorId);
    return actor
      .fetch('https://engineActor.internal/socket.io', ctx.req.raw)
      .then(res => new Response(res.body, res));
  }
);
