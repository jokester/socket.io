import {Hono} from 'hono';
import type {DurableObjectNamespace} from '@cloudflare/workers-types';
import {createDebugLogger} from '@jokester/socket.io-serverless/src/utils/logger';

export interface WorkerBindings extends Record<string, unknown> {
    engineActor: DurableObjectNamespace
    socketActor: DurableObjectNamespace
}

const debugLogger = createDebugLogger('sio-worker:workerApp');

export const workerApp = new Hono<{ Bindings: WorkerBindings }>().get(
    '/socket.io/*',
    async ctx => {
        // debugLogger('ws connection request', ctx.req.url);

        const actorId = ctx.env.engineActor.idFromString("singleton");
        const actor = ctx.env.engineActor.get(actorId);

        const sessionId = Math.random().toString(16).slice(2, 12)
        // @ts-ignore
        const res = await actor.fetch(`https://eioServer.internal/socket.io/?sid=${sessionId}`, ctx.req.raw);
        // @ts-ignore
        return new Response(res.body, res);
    }
);
