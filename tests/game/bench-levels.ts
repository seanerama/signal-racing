/**
 * Representative level shapes for grid-search timing and tests, built on the Stage 5 stub A2
 * (Stage 6 and 8 own the real content). Tracks and lever sets follow the Stage 6/8 notes:
 * A3 = stop at 1 km with weight_dist unlocked; A4, B1L, B4L = all four levers.
 */
import type { LeverSpec, LevelConfig, LevelId } from '@/levels/types';
import { STUB_A2 } from '@/levels/index';
import { TRACK_A3, TRACK_A4, TRACK_B1, TRACK_B4 } from '../engine/fixtures';

const [STUB_RAMP, PRESSURE] = STUB_A2.levers as [LeverSpec, LeverSpec];
/** Stage 2b ramp range: 0–3.0 s, step 0.2 (Stage 6 owns the real level configs). */
export const RAMP: LeverSpec = { ...STUB_RAMP, min: 0, max: 3.0, step: 0.2, default: 0 };
export const WEIGHT: LeverSpec = {
  id: 'weight_dist',
  label: 'Weight distribution',
  quantity: 'fraction',
  min: 0.38,
  max: 0.52,
  step: 0.02,
  default: 0.46,
};
export const WING: LeverSpec = {
  id: 'wing',
  label: 'Wing',
  quantity: 'angle_int',
  min: 0,
  max: 8,
  step: 1,
  default: 4,
};

function variant(id: LevelId, patch: Partial<LevelConfig>): LevelConfig {
  return { ...STUB_A2, id, ...patch };
}

export const BENCH_A2 = variant('A2', { levers: [RAMP, PRESSURE] });
export const BENCH_A3 = variant('A3', {
  track: TRACK_A3,
  levers: [RAMP, PRESSURE, WEIGHT],
  lockedLevers: { wing: 4 },
});
export const BENCH_A4 = variant('A4', {
  track: TRACK_A4,
  levers: [RAMP, PRESSURE, WEIGHT, WING],
  lockedLevers: {},
  tolerance: 0.005,
});
export const BENCH_B1L = variant('B1L', {
  phase: 'B',
  track: TRACK_B1,
  levers: [RAMP, PRESSURE, WEIGHT, WING],
  lockedLevers: {},
  tolerance: 0.005,
  scoreTarget: 'compromise_gap',
  segmentFloorSource: 'engine_optimum',
});
export const BENCH_B4L = variant('B4L', {
  phase: 'B',
  track: TRACK_B4,
  levers: [RAMP, PRESSURE, WEIGHT, WING],
  lockedLevers: {},
  tolerance: 0.005,
  conditions: {
    base: STUB_A2.conditions.base,
    variation: { gripFrac: 0.01, trackTempC: 3 },
  },
  assist: true,
});

/** Budgets from contract 05 (A4 is not listed there; the stage brief gives "others < 4 s"). */
export const BENCH_LEVELS: Array<{ level: LevelConfig; budgetMs: number }> = [
  { level: BENCH_A2, budgetMs: 1000 },
  { level: BENCH_A3, budgetMs: 1000 },
  { level: BENCH_A4, budgetMs: 4000 },
  { level: BENCH_B1L, budgetMs: 2000 },
  { level: BENCH_B4L, budgetMs: 4000 },
];
