/**
 * In-process worker adapter for Vitest (the "handler adapter" of the Stage 5 brief).
 *
 * Worker tests do not spawn a `worker_threads` worker (that would need a TS loader inside the
 * thread). Instead this adapter runs the REAL worker message loop (`attachHandlers` from
 * `src/worker/dispatch.ts`, with the real `handlers`) in the same process, behind an object with
 * the `Worker` interface. Messages in both directions go through `structuredClone(msg, { transfer })`,
 * which has the same semantics as `postMessage`: transferred ArrayBuffers are detached on the
 * sending side. That makes the zero-copy transfer test meaningful, and the reconstructed error
 * types are exercised exactly as in the browser.
 */
import { attachHandlers, type WorkerScope } from '@/worker/dispatch';
import { handlers as realHandlers, type Handlers } from '@/worker/handlers';
import type { RpcRequest } from '@/worker/types';

type Listener = (ev: MessageEvent) => void;

export interface InProcessWorker extends Worker {
  /** The worker-side message values posted so far (before cloning), newest last. */
  readonly posted: Array<{ message: unknown; transfer: Transferable[] }>;
  terminated: boolean;
}

export function createInProcessWorker(handlers: Handlers = realHandlers): InProcessWorker {
  const mainListeners = new Map<string, Set<Listener>>();
  const workerListeners = new Set<(ev: MessageEvent<RpcRequest>) => void>();
  const posted: InProcessWorker['posted'] = [];
  let terminated = false;

  const scope: WorkerScope = {
    postMessage(message, transfer = []) {
      posted.push({ message, transfer });
      const cloned: unknown = structuredClone(message, { transfer });
      queueMicrotask(() => {
        if (terminated) return;
        for (const l of mainListeners.get('message') ?? []) l({ data: cloned } as MessageEvent);
      });
    },
    addEventListener(_type, listener) {
      workerListeners.add(listener);
    },
  };
  attachHandlers(scope, handlers);

  const worker = {
    posted,
    get terminated() {
      return terminated;
    },
    set terminated(v: boolean) {
      terminated = v;
    },
    postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
      const list = Array.isArray(transfer) ? transfer : (transfer.transfer ?? []);
      const cloned = structuredClone(message, { transfer: list }) as RpcRequest;
      // A real worker runs on another thread: deliver on a later task, not synchronously.
      setTimeout(() => {
        if (terminated) return;
        for (const l of workerListeners) l({ data: cloned } as MessageEvent<RpcRequest>);
      }, 0);
    },
    addEventListener(type: string, listener: Listener) {
      let set = mainListeners.get(type);
      if (!set) mainListeners.set(type, (set = new Set()));
      set.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      mainListeners.get(type)?.delete(listener);
    },
    terminate() {
      terminated = true;
    },
  };
  return worker as unknown as InProcessWorker;
}
