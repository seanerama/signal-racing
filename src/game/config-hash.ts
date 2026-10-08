/**
 * Stable hash of a level's sim-relevant fields (contract 05): the grid-search cache key and the
 * precomputed-target key are `${levelId}:${configHash}`.
 *
 * Covered: track, unlocked levers (grid points), locked levers, flags, the *effective* car
 * (`DEFAULT_CAR` merged with the level's overrides, so engine tuning changes the hash), base
 * conditions, tolerance, and `GRID_ALGO_VERSION`. Not covered: text, channels, hint rules, budget.
 * Engine *equation* changes do not change the hash; `tests/game/precomputed-targets.slow.test.ts`
 * recomputes the stored targets to catch those.
 */
import { DEFAULT_CAR } from '@/engine/index';
import type { CarParams } from '@/engine/types';
import type { LevelConfig } from '@/levels/types';

/** Bump when the grid-search algorithm changes what it returns. */
export const GRID_ALGO_VERSION = 1;

/** JSON with object keys sorted, so key order never changes the hash. */
export function stableStringify(x: unknown): string {
  if (x === null || typeof x !== 'object') {
    // JSON has no Infinity/NaN; keep them distinct from null.
    if (typeof x === 'number' && !Number.isFinite(x)) return `"${String(x)}"`;
    return JSON.stringify(x) ?? 'null';
  }
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  const obj = x as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 53-bit string hash (cyrb53), as 14 hex digits. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

/** The effective car of a level. */
export function levelCar(level: LevelConfig): CarParams {
  return { ...DEFAULT_CAR, ...level.car };
}

/** The fields the hash covers, in a plain object (exported for tests and the precompute script). */
export function hashedFields(level: LevelConfig): Record<string, unknown> {
  return {
    algo: GRID_ALGO_VERSION,
    track: level.track,
    levers: level.levers.map(({ id, min, max, step }) => ({ id, min, max, step })),
    lockedLevers: level.lockedLevers,
    flags: level.flags,
    car: levelCar(level),
    conditions: level.conditions.base,
    tolerance: level.tolerance,
  };
}

export function configHash(level: LevelConfig): string {
  return hashString(stableStringify(hashedFields(level)));
}

/** `${levelId}:${configHash}`: the grid cache and precomputed-target key. */
export function gridKey(level: LevelConfig): string {
  return `${level.id}:${configHash(level)}`;
}
