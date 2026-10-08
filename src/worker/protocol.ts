/**
 * Error (de)serialisation across the worker boundary. The worker never throws an untyped
 * error across it: unknown errors become `{ name: 'WorkerError' }`.
 */
import type { RpcError } from './types';

/** Error → wire form. Own enumerable fields (e.g. `field`, `step`, `state`) go in `detail`. */
export function serializeError(err: unknown): RpcError {
  if (err instanceof Error) {
    const detail: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(err)) detail[k] = v;
    return {
      name: err.name && err.name !== 'Error' ? err.name : 'WorkerError',
      message: err.message,
      ...(Object.keys(detail).length > 0 ? { detail } : {}),
    };
  }
  return { name: 'WorkerError', message: String(err) };
}

/**
 * Wire form → Error. Stage 5 maps `SimInputError` / `SimDivergedError` names to their classes;
 * until then every error is a plain `Error` carrying the original name and detail fields.
 */
export function deserializeError(e: RpcError): Error {
  const err = new Error(e.message);
  err.name = e.name;
  if (e.detail) Object.assign(err, e.detail);
  return err;
}
