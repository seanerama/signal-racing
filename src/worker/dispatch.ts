/**
 * Worker-side message loop: routes `{ id, type, payload }` to a handler, posts throttled
 * progress events and the reply (with its transfer list). Errors are serialised by
 * `serializeError`, so nothing untyped crosses the boundary. Shared by `sim.worker.ts` and the
 * in-process test adapter.
 */
import type { HandlerCtx, Handlers } from './handlers';
import { serializeError } from './protocol';
import type { RpcMethods, RpcRequest, RpcResponse, RpcType } from './types';

/** The parts of `DedicatedWorkerGlobalScope` the loop uses. */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<RpcRequest>) => void): void;
}

export function attachHandlers(scope: WorkerScope, handlers: Handlers): void {
  scope.addEventListener('message', (ev) => {
    const { id, type, payload } = ev.data;
    void (async () => {
      const ctx: HandlerCtx = {
        progress: (frac) => scope.postMessage({ id, progress: frac }),
        transfer: [],
      };
      let reply: RpcResponse;
      try {
        const handler = handlers[type] as
          | ((p: unknown, c: HandlerCtx) => RpcMethods[RpcType]['res'] | Promise<unknown>)
          | undefined;
        if (!handler) throw new Error(`unknown request type: ${String(type)}`);
        const value = (await handler(payload, ctx)) as RpcMethods[RpcType]['res'];
        reply = { id, ok: true, value };
      } catch (err) {
        ctx.transfer.length = 0;
        reply = { id, ok: false, error: serializeError(err) };
      }
      scope.postMessage(reply, ctx.transfer);
    })();
  });
}
