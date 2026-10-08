/**
 * Error (de)serialisation across the worker boundary. The worker never throws an untyped
 * error across it: unknown errors become `{ name: 'WorkerError' }`.
 */
import { SimDivergedError, SimInputError } from '@/engine/errors';
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
 * Wire form → Error. `SimInputError` / `SimDivergedError` come back as instances of their classes
 * with the same fields and message; every other error is an `Error` carrying the original `name`
 * (`WorkerError` for anything untyped) and detail fields.
 */
export function deserializeError(e: RpcError): Error {
  const d = e.detail ?? {};
  let err: Error;
  if (e.name === 'SimInputError') {
    err = new SimInputError(typeof d.field === 'string' ? d.field : 'unknown', '');
  } else if (e.name === 'SimDivergedError') {
    const step = typeof d.step === 'number' ? d.step : -1;
    const state =
      typeof d.state === 'object' && d.state !== null ? (d.state as Record<string, number>) : {};
    err = new SimDivergedError(step, state);
  } else {
    err = new Error(e.message);
    if (e.detail) Object.assign(err, e.detail);
  }
  err.name = e.name;
  err.message = e.message;
  return err;
}
