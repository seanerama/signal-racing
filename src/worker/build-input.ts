/**
 * `(level, setup, runIndex) → SimInput`: the one place a level config becomes an engine input.
 * Runs in the worker (player runs, grid search) and in Node tests.
 *
 * - Setup: unlocked levers come from the player's setup, locked levers override it
 *   (`level.lockedLevers`), and any lever neither provides falls back to `FALLBACK_SETUP`.
 * - Seed (contract 05, amended): ALWAYS per run, `runSeed(levelId, runIndex)`. It drives the
 *   telemetry noise and distractors every run.
 * - Conditions: `level.conditions.base`, plus per-run variation only when the level declares
 *   `conditions.variation`, drawn from `createRng(seed).fork('conditions')`:
 *   `gripMultiplier × (1 + gripFrac·u₁)`, `trackTemp + trackTempC·u₂`, `u ~ U[−1, 1)`.
 */
import { DEFAULT_CAR } from '@/engine/index';
import { createRng } from '@/engine/rng';
import type { Conditions, Setup, SimInput } from '@/engine/types';
import type { LevelConfig, LevelId } from '@/levels/types';

/** Values for levers a level neither unlocks nor locks (contract 01 base setup). */
export const FALLBACK_SETUP: Readonly<Setup> = Object.freeze({
  throttle_ramp: 0,
  tire_pressure: 1.65,
  weight_dist: 0.45,
  wing: 4,
});

/** FNV-1a, 32-bit. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** `hash(levelId, runIndex)` as a uint32. Run index 0 is the grid search's fixed seed. */
export function runSeed(levelId: LevelId, runIndex: number): number {
  return fnv1a(`${levelId}#${runIndex}`);
}

/** The full setup the engine sees: player levers, then locked levers on top. */
export function effectiveSetup(level: LevelConfig, setup: Partial<Setup>): Setup {
  const defaults: Partial<Setup> = {};
  for (const l of level.levers) defaults[l.id] = l.default;
  return { ...FALLBACK_SETUP, ...defaults, ...setup, ...level.lockedLevers };
}

/** Conditions for a run seed: base, plus variation if the level declares it. */
export function runConditions(level: LevelConfig, seed: number): Conditions {
  const base = level.conditions.base;
  const variation = level.conditions.variation;
  if (!variation) return { ...base };
  const rng = createRng(seed).fork('conditions');
  const u1 = 2 * rng.next() - 1;
  const u2 = 2 * rng.next() - 1;
  return {
    ...base,
    gripMultiplier: base.gripMultiplier * (1 + variation.gripFrac * u1),
    trackTemp: base.trackTemp + variation.trackTempC * u2,
  };
}

/** A player run: per-run seed and (if declared) per-run condition variation. */
export function buildSimInput(
  level: LevelConfig,
  setup: Partial<Setup>,
  runIndex: number,
): SimInput {
  const seed = runSeed(level.id, runIndex);
  return {
    car: { ...DEFAULT_CAR, ...level.car },
    setup: effectiveSetup(level, setup),
    track: level.track,
    conditions: runConditions(level, seed),
    flags: level.flags,
    seed,
  };
}

/** Grid search: base conditions (no variation) and the fixed seed `runSeed(levelId, 0)`. */
export function buildBaseSimInput(level: LevelConfig, setup: Partial<Setup>): SimInput {
  return {
    car: { ...DEFAULT_CAR, ...level.car },
    setup: effectiveSetup(level, setup),
    track: level.track,
    conditions: { ...level.conditions.base },
    flags: level.flags,
    seed: runSeed(level.id, 0),
  };
}
