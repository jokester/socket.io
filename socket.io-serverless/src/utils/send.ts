import type * as CF from '@cloudflare/workers-types';
import {lazyThenable} from '@jokester/ts-commonutil/lib/concurrency/lazy-thenable';

export type ActorMethodMap = Record<string, (...args: any[]) => Promise<any>>;

const dummyUrlPrefix = 'https://dummy-origin.internal/';

export interface WrappedResponse<T> {
  res: CF.Response;
  json(): PromiseLike<T>;
}

export async function send<
  Methods extends ActorMethodMap,
  M extends keyof Methods
>(
  dest: {
    kind: CF.DurableObjectNamespace;
    id: CF.DurableObjectId;
  },
  method: M,
  params: Parameters<Methods[M]>
): Promise<WrappedResponse<Awaited<ReturnType<Methods[M]>>>> {
  const res = await dest.kind
    .get(dest.id)
    .fetch(`${dummyUrlPrefix}${String(method)}`, {
      method: 'POST',
      /** FIXME: maybe try superjson to support more primitive-like values? */
      // FIXME: content-type?
      body: JSON.stringify(params),
    });
  const resAsJson = lazyThenable<any>(() => res.json());
  return {
    res,
    json: () => resAsJson,
  }
}

export function buildSend<Methods extends ActorMethodMap>() {
  return send as <M extends keyof Methods>(
    dest: {
      kind: CF.DurableObjectNamespace;
      id: CF.DurableObjectId;
    },
    method: M,
    params: Parameters<Methods[M]>
  ) => Promise<WrappedResponse<Awaited<ReturnType<Methods[M]>>>>;
}
