/**
 * Precomputed grid-search targets (Stage 8 amendment 1). `scripts/precompute-targets.ts` runs the
 * real grid search for every level at build time (`prebuild`) and writes
 * `precomputed-targets.json`, keyed by `${levelId}:${configHash}` with the full `GridResult`
 * (samples included, for the response surface).
 *
 * The session uses an entry only when its key matches the level's current config hash; any
 * mismatch falls back to the live worker search, so the game never shows a stale target.
 * `tests/game/precomputed-targets.slow.test.ts` (`npm run test:slow`) recomputes every entry and
 * compares bit-for-bit, which catches engine-equation changes the hash cannot see.
 *
 * JSON has no Infinity/NaN: non-finite numbers (unfinished samples) are stored as the strings
 * `"Infinity"`, `"-Infinity"`, `"NaN"` and revived on load.
 */
import type { GridResult } from '@/worker/types';

export const PRECOMPUTED_VERSION = 1;

export interface PrecomputedFile {
  version: number;
  entries: Record<string, GridResult>;
}

const NON_FINITE: Record<string, number> = {
  Infinity: Infinity,
  '-Infinity': -Infinity,
  NaN: NaN,
};

/** JSON replacer: non-finite numbers → strings. */
export function encodeNumber(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
}

/** Revives the strings `encodeNumber` wrote (only where a number is expected). */
function revive(x: unknown): unknown {
  if (typeof x === 'string' && x in NON_FINITE) return NON_FINITE[x];
  if (Array.isArray(x)) return x.map(revive);
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = revive(v);
    return out;
  }
  return x;
}

/** Serialises a file of entries, deterministic for identical results. */
export function encodePrecomputed(entries: Record<string, GridResult>): string {
  const file: PrecomputedFile = { version: PRECOMPUTED_VERSION, entries };
  return JSON.stringify(file, encodeNumber) + '\n';
}

export function decodePrecomputed(raw: unknown): Record<string, GridResult> {
  const f = raw as Partial<PrecomputedFile> | null;
  if (!f || f.version !== PRECOMPUTED_VERSION || typeof f.entries !== 'object' || !f.entries) {
    return {};
  }
  return revive(f.entries) as Record<string, GridResult>;
}

let table: Promise<Record<string, GridResult>> | null = null;

/** The bundled table (a lazily loaded chunk in the standard build). Never rejects. */
export function precomputedTable(): Promise<Record<string, GridResult>> {
  table ??= import('./precomputed-targets.json').then(
    (m: { default: unknown }) => decodePrecomputed(m.default),
    () => ({}),
  );
  return table;
}

/** The precomputed result for `key`, or null. */
export async function precomputedGrid(key: string): Promise<GridResult | null> {
  const t = await precomputedTable();
  const hit = t[key];
  return hit && `${hit.levelId}:${hit.configHash}` === key ? hit : null;
}
