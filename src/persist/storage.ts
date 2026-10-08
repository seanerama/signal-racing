/**
 * Versioned localStorage (contract 01). Never throws: the game must work with storage
 * unavailable, corrupt or from an older version (all fall back, with a `warn`).
 *
 * Keys live under the `signal.v1.` namespace: `load('progress', …)` reads `signal.v1.progress`.
 * A key that already starts with `signal.` is used as is. Values are stored as
 * `{ "v": <version>, "data": <value> }`.
 */
import { log } from '@/app/log';

export const KEY_PREFIX = 'signal.v1.';

interface Envelope<T> {
  v: number;
  data: T;
}

/** The namespaced storage key for `name`. */
export function storageKey(name: string): string {
  return name.startsWith('signal.') ? name : KEY_PREFIX + name;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isEnvelope(x: unknown): x is Envelope<unknown> {
  return typeof x === 'object' && x !== null && 'v' in x && 'data' in x;
}

/** Reads `key` at `version`. Missing, corrupt, wrong-version or unavailable → `fallback`. */
export function load<T>(key: string, version: number, fallback: T): T {
  const k = storageKey(key);
  let raw: string | null;
  try {
    const store = getStorage();
    if (!store) return fallback;
    raw = store.getItem(k);
  } catch (err) {
    log.warn('storage unavailable, using defaults for', k, err);
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) {
      log.warn('discarding malformed storage value for', k);
      return fallback;
    }
    if (parsed.v !== version) {
      log.warn(`discarding storage for ${k}: version ${String(parsed.v)} ≠ ${version}`);
      return fallback;
    }
    return parsed.data as T;
  } catch (err) {
    log.warn('discarding corrupt storage value for', k, err);
    return fallback;
  }
}

/** Writes `value` at `version`. Failures (quota, unavailable, unserialisable) are logged, not thrown. */
export function save<T>(key: string, version: number, value: T): void {
  const k = storageKey(key);
  try {
    const store = getStorage();
    if (!store) return;
    const envelope: Envelope<T> = { v: version, data: value };
    store.setItem(k, JSON.stringify(envelope));
  } catch (err) {
    log.warn('could not save', k, err);
  }
}
