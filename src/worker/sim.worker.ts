/**
 * Sim worker. SKELETON (Stage 1): only `ping`. Stage 5 adds `run` and `gridSearch`.
 *
 * Wire format: requests `{ id, type, payload }`, replies `{ id, ok: true, value }` or
 * `{ id, ok: false, error: { name, message, detail? } }`.
 */
import { serializeError } from './protocol';
import type { RpcMethods, RpcRequest, RpcResponse, RpcType } from './types';

/** The parts of `DedicatedWorkerGlobalScope` this worker uses (the project compiles with the DOM lib). */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<RpcRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

type Handlers = {
  [T in RpcType]: (
    payload: RpcMethods[T]['req'],
  ) => RpcMethods[T]['res'] | Promise<RpcMethods[T]['res']>;
};

const handlers: Handlers = {
  ping: (payload) => ({ reply: 'pong', sentAt: payload.sentAt }),
};

scope.addEventListener('message', (ev) => {
  const { id, type, payload } = ev.data;
  void (async () => {
    let reply: RpcResponse;
    try {
      const handler = handlers[type] as ((p: unknown) => unknown) | undefined;
      if (!handler) throw new Error(`unknown request type: ${String(type)}`);
      const value = (await handler(payload)) as RpcMethods[RpcType]['res'];
      reply = { id, ok: true, value };
    } catch (err) {
      reply = { id, ok: false, error: serializeError(err) };
    }
    scope.postMessage(reply);
  })();
});
