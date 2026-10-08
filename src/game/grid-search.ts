/**
 * Grid-search targets (contract 05). Pure and synchronous; runs in the worker (and in Node tests
 * and the precompute script). Never call it on the main thread.
 *
 * - Exhaustive over the cartesian product of the unlocked levers' step grids when that has
 *   ≤ `EXHAUSTIVE_LIMIT` points.
 * - Otherwise coarse → fine: 6 evenly spaced points per lever (endpoints included, snapped to
 *   steps), then an exhaustive ±2-step box around each of the best 3 coarse points.
 * - `fast` mode, base conditions (no per-run variation), fixed seed `runSeed(levelId, 0)`.
 * - `segmentFloors[i]` = min over every evaluated setup of segment i's time; `samples` = every
 *   evaluated point.
 *
 * Performance (Stage 5): `throttle_ramp` varies fastest and one `SimCache` is shared across the
 * search, so setups that differ only in ramp reuse the driver plan (corner limits and braking
 * envelope). Results are bit-identical to uncached simulation.
 */
import { createSimCache, simulate } from '@/engine/index';
import type { LeverId, Outcome, Setup } from '@/engine/types';
import type { LeverSpec, LevelConfig } from '@/levels/types';
import { buildBaseSimInput } from '@/worker/build-input';
import type { GridResult } from '@/worker/types';
import { configHash } from './config-hash';

/** Grids up to this many points are searched exhaustively (contract 05). */
export const EXHAUSTIVE_LIMIT = 5000;
/** Coarse points per lever. */
export const COARSE_POINTS = 6;
/** Fine pass: ± this many steps around each seed. */
export const FINE_RADIUS = 2;
/** Fine pass: number of best coarse points to refine. */
export const FINE_SEEDS = 3;
/** Minimum interval between progress events. */
export const PROGRESS_INTERVAL_MS = 50;

export interface GridSearchOptions {
  /** Called with 0–1, at most every `PROGRESS_INTERVAL_MS`, and once with 1 at the end. */
  onProgress?: (frac: number) => void;
  /** Test flag: use coarse → fine even when the grid is small enough to enumerate. */
  forceCoarse?: boolean;
  /** Clock (ms); defaults to `performance.now`. */
  now?: () => number;
}

/** Decimal places of a number's shortest representation (`0.02` → 2). */
function decimals(x: number): number {
  const s = String(x);
  if (s.includes('e-')) return Number(s.split('e-')[1] ?? 0);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** The step grid of one lever, built from integers so values are exact (`0.1·3 = 0.3`). */
export function leverGrid(l: LeverSpec): number[] {
  const n = Math.round((l.max - l.min) / l.step) + 1;
  const dp = Math.max(decimals(l.step), decimals(l.min));
  return Array.from({ length: n }, (_, i) => Number((l.min + i * l.step).toFixed(dp)));
}

/** Indices of `k` evenly spaced points on a grid of `n` (endpoints included, deduplicated). */
export function evenIndices(n: number, k: number): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let j = 0; j < k; j++) {
    const i = Math.round((j * (n - 1)) / (k - 1));
    if (out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

/** Unlocked levers in search order: `throttle_ramp` last, so it varies fastest. */
function searchLevers(level: LevelConfig): LeverSpec[] {
  const unlocked = level.levers.filter((l) => !(l.id in level.lockedLevers));
  return [...unlocked].sort(
    (a, b) => Number(a.id === 'throttle_ramp') - Number(b.id === 'throttle_ramp'),
  );
}

/** Cartesian product of index lists, last list varying fastest. */
function product(lists: number[][]): number[][] {
  let acc: number[][] = [[]];
  for (const list of lists) {
    const next: number[][] = [];
    for (const prefix of acc) for (const i of list) next.push([...prefix, i]);
    acc = next;
  }
  return acc;
}

export function gridSize(level: LevelConfig): number {
  return searchLevers(level).reduce((n, l) => n * leverGrid(l).length, 1);
}

export function gridSearch(level: LevelConfig, opts: GridSearchOptions = {}): GridResult {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const levers = searchLevers(level);
  const grids = levers.map(leverGrid);
  const ids: LeverId[] = levers.map((l) => l.id);
  const total = grids.reduce((n, g) => n * g.length, 1);
  const exhaustive = !opts.forceCoarse && total <= EXHAUSTIVE_LIMIT;

  const cache = createSimCache();
  const evaluated = new Map<string, { idx: number[]; outcome: Outcome; setup: Setup }>();
  const samples: GridResult['samples'] = [];
  const floors: number[] = level.track.segments.map(() => Infinity);
  let best: { setup: Setup; outcome: Outcome } | null = null;

  let planned = 0;
  let lastEmit = -Infinity;
  const progress = (): void => {
    if (!opts.onProgress) return;
    const t = now();
    if (t - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = t;
    opts.onProgress(Math.min(1, evaluated.size / Math.max(1, planned)));
  };

  const evaluate = (idx: number[]): Outcome => {
    const key = idx.join(',');
    const hit = evaluated.get(key);
    if (hit) return hit.outcome;
    const setup: Partial<Setup> = {};
    idx.forEach((i, k) => {
      setup[ids[k]!] = grids[k]![i]!;
    });
    const input = buildBaseSimInput(level, setup);
    const { outcome } = simulate(input, 'fast', cache);
    evaluated.set(key, { idx, outcome, setup: input.setup });
    samples.push({ setup: input.setup, totalTime: outcome.totalTime });
    outcome.segmentTimes.forEach((t, i) => {
      if (t < (floors[i] ?? Infinity)) floors[i] = t;
    });
    if (!best || outcome.totalTime < best.outcome.totalTime) {
      best = { setup: input.setup, outcome };
    }
    progress();
    return outcome;
  };

  if (exhaustive) {
    const points = product(grids.map((g) => g.map((_, i) => i)));
    planned = points.length;
    points.forEach(evaluate);
  } else {
    const coarse = product(grids.map((g) => evenIndices(g.length, COARSE_POINTS)));
    // Upper bound for the fine pass until the seeds are known.
    planned = coarse.length + FINE_SEEDS * (2 * FINE_RADIUS + 1) ** grids.length;
    const scored = coarse.map((idx) => ({ idx, time: evaluate(idx).totalTime }));
    // Stable sort: ties keep evaluation order.
    const seeds = [...scored].sort((a, b) => a.time - b.time).slice(0, FINE_SEEDS);
    const fine = new Map<string, number[]>();
    for (const { idx } of seeds) {
      const box = product(
        idx.map((c, k) => {
          const n = grids[k]!.length;
          const lo = Math.max(0, c - FINE_RADIUS);
          const hi = Math.min(n - 1, c + FINE_RADIUS);
          return Array.from({ length: hi - lo + 1 }, (_, j) => lo + j);
        }),
      );
      for (const p of box) fine.set(p.join(','), p);
    }
    planned = coarse.length + [...fine.keys()].filter((k) => !evaluated.has(k)).length;
    for (const p of fine.values()) evaluate(p);
  }

  const optimum = best as { setup: Setup; outcome: Outcome } | null;
  if (!optimum) throw new Error(`grid search for ${level.id}: no setup evaluated`);
  opts.onProgress?.(1);
  return {
    levelId: level.id,
    configHash: configHash(level),
    optimum,
    target: optimum.outcome.totalTime * (1 + level.tolerance),
    segmentFloors: floors,
    samples,
    evaluated: evaluated.size,
    ms: now() - t0,
  };
}
