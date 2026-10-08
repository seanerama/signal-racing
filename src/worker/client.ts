/**
 * Main-thread RPC to the sim worker: `createWorkerRpc` (a typed request/response channel with
 * request ids, progress events, typed error reconstruction and transfer lists) and
 * `createSimClient` (contract 05) on top of it. This is the only way the UI reaches the engine.
 */
import { log } from '@/app/log';
import { deserializeError } from './protocol';
import { spawnSimWorker } from './spawn';
import type { RpcMessageFromWorker, RpcMethods, RpcType, SimClient } from './types';

export type { GridResult, RunPayload, SimClient } from './types';

export interface WorkerRpc {
  /** Sends one request; resolves with the reply value or rejects with a reconstructed error. */
  request<T extends RpcType>(
    type: T,
    payload: RpcMethods[T]['req'],
    opts?: { transfer?: Transferable[]; onProgress?: (frac: number) => void },
  ): Promise<RpcMethods[T]['res']>;
  /** Round-trips a `ping`; `rttMs` is measured on the main thread. */
  ping(): Promise<{ reply: 'pong'; rttMs: number }>;
  dispose(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  onProgress?: (frac: number) => void;
}

export function createWorkerRpc(worker: Worker = spawnSimWorker()): WorkerRpc {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  worker.addEventListener('message', (ev: MessageEvent<RpcMessageFromWorker>) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if ('progress' in msg) {
      p.onProgress?.(msg.progress);
      return;
    }
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(deserializeError(msg.error));
  });

  worker.addEventListener('error', (ev) => {
    log.error('sim worker error', ev.message);
    const err = new Error(ev.message || 'sim worker failed');
    err.name = 'WorkerError';
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });

  const request: WorkerRpc['request'] = (type, payload, opts) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, {
        resolve,
        reject,
        onProgress: opts?.onProgress,
      });
      worker.postMessage({ id, type, payload }, opts?.transfer ?? []);
    });

  return {
    request,
    async ping() {
      const sentAt = performance.now();
      const res = await request('ping', { sentAt });
      const rttMs = performance.now() - res.sentAt;
      log.debug(`worker ping ${rttMs.toFixed(2)}ms`);
      return { reply: res.reply, rttMs };
    },
    dispose() {
      worker.terminate();
      const err = new Error('worker disposed');
      err.name = 'WorkerError';
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    },
  };
}

/**
 * The sim client (contract 05). `worker` defaults to the real sim worker; tests pass an
 * in-process adapter (`tests/worker/adapter.ts`).
 */
export function createSimClient(worker?: Worker): SimClient {
  const rpc = createWorkerRpc(worker ?? spawnSimWorker());
  return {
    run: (req) => rpc.request('run', req),
    async gridSearch(req, onProgress) {
      const res = await rpc.request('gridSearch', req, onProgress ? { onProgress } : undefined);
      log.debug(`grid search ${res.levelId}: ${res.ms.toFixed(0)} ms, ${res.evaluated} setups`);
      return res;
    },
    dispose: () => rpc.dispose(),
  };
}
