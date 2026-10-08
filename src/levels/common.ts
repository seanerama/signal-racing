/**
 * Shared level content: tracks, lever specs, flags, conditions and the summary helpers hint rules
 * are written with. Pure data and pure functions (the `levels` layer may import the engine, never
 * the UI).
 *
 * Rules are written against channel behaviour (a slip ratio above the peak-grip slip, μ below
 * its peak), not against tuned engine constants, so they survive engine retunes. Car parameters
 * that a rule needs (the pressure → μ bell) are read from the level's effective car, never copied.
 */
import { DEFAULT_CAR, LEVER_RANGES } from '@/engine/index';
import type { CarParams, ChannelId, ModelFlags, Track } from '@/engine/types';
import type { HintCtx } from '@/hints/types';
import type { RunSummary } from '@/telemetry/types';
import type { ConditionsSpec, LeverSpec, LevelConfig } from './types';

// ---- Tracks ----

/** A1/A2: 1 km straight from a standing start. */
export const TRACK_STRAIGHT: Track = {
  id: 'straight_1000',
  standingStart: true,
  laps: 1,
  segments: [{ id: 'launch', label: 'Straight', kind: 'straight', length: 1000 }],
};

/** A3: 1 km launch, then brake to a stop exactly at the end. */
export const TRACK_LAUNCH_STOP: Track = {
  id: 'launch_stop_1000',
  standingStart: true,
  laps: 1,
  segments: [
    {
      id: 'run_stop',
      label: 'Launch and stop',
      kind: 'straight',
      length: 1000,
      endsWithStop: true,
    },
  ],
};

/** A4: 200 m run-up, an 80 m radius 90° left, 150 m run-out. */
export const TRACK_CORNER: Track = {
  id: 'corner_80',
  standingStart: true,
  laps: 1,
  segments: [
    { id: 'runup', label: 'Run-up', kind: 'straight', length: 200 },
    {
      id: 'corner',
      label: 'Corner',
      kind: 'corner',
      length: 80 * (Math.PI / 2),
      radius: 80,
      direction: 'left',
    },
    { id: 'runout', label: 'Run-out', kind: 'straight', length: 150 },
  ],
};

/** B1L: 1 km straight from a standing start, a 150 m radius 90° right, a 150 m run-out. */
export const TRACK_JOIN: Track = {
  id: 'join_b1l',
  standingStart: true,
  laps: 1,
  segments: [
    { id: 'straight', label: 'Straight', kind: 'straight', length: 1000 },
    {
      id: 'fast_corner',
      label: 'Fast corner',
      kind: 'corner',
      length: 150 * (Math.PI / 2),
      radius: 150,
      direction: 'right',
    },
    { id: 'run_out', label: 'Run-out', kind: 'straight', length: 150 },
  ],
};

/**
 * B4L "The Puzzle" (lite): main straight → fast 90° right → back straight → 35 m hairpin →
 * run to a stop. An open circuit: the hairpin turns the car back alongside the main straight.
 */
export const TRACK_PUZZLE: Track = {
  id: 'puzzle_b4l',
  standingStart: true,
  laps: 1,
  segments: [
    { id: 'main_straight', label: 'Main straight', kind: 'straight', length: 1000 },
    {
      id: 'fast_corner',
      label: 'Fast corner',
      kind: 'corner',
      length: 150 * (Math.PI / 2),
      radius: 150,
      direction: 'right',
    },
    { id: 'back_straight', label: 'Back straight', kind: 'straight', length: 500 },
    {
      id: 'hairpin',
      label: 'Hairpin',
      kind: 'corner',
      length: 35 * Math.PI,
      radius: 35,
      direction: 'right',
    },
    { id: 'run_stop', label: 'Run to stop', kind: 'straight', length: 400, endsWithStop: true },
  ],
};

// ---- Flags and conditions ----

export const FLAGS_NO_GRIP_LIMIT: ModelFlags = {
  tractionLimit: false,
  pressureAffectsGrip: false,
  tempAffectsGrip: false,
};

export const FLAGS_GRIP: ModelFlags = {
  tractionLimit: true,
  pressureAffectsGrip: true,
  tempAffectsGrip: false,
};

export const DRY: ConditionsSpec = {
  base: { trackTemp: 30, ambientTemp: 20, gripMultiplier: 1 },
};

// ---- Levers (amended ranges, stage 6 instructions) ----

/** The amended ramp range is 0–3.0 s (Stage 2b). */
export const RAMP_SPEC_MAX = 3.0;
export const RAMP_STEP = 0.2;

/**
 * The ramp lever's upper end: the amended 3.0 s, clamped to what the engine on this branch
 * validates (and rounded down onto the step grid), so the grid search never asks the engine for
 * an out-of-range ramp. With Stage 2b merged (engine range 0–3.0 s) this is exactly 3.0.
 */
export const RAMP_MAX =
  Math.floor(Math.min(RAMP_SPEC_MAX, LEVER_RANGES.throttle_ramp[1]) / RAMP_STEP + 1e-9) * RAMP_STEP;

export function rampLever(def: number): LeverSpec {
  return {
    id: 'throttle_ramp',
    label: 'Throttle ramp',
    quantity: 'time',
    min: 0,
    max: Number(RAMP_MAX.toFixed(1)),
    step: RAMP_STEP,
    default: def,
  };
}

export function pressureLever(def: number): LeverSpec {
  return {
    id: 'tire_pressure',
    label: 'Tire pressure',
    quantity: 'pressure',
    min: 1.2,
    max: 2.2,
    step: 0.1,
    default: def,
  };
}

export function weightLever(def: number): LeverSpec {
  return {
    id: 'weight_dist',
    label: 'Weight distribution',
    quantity: 'fraction',
    min: 0.38,
    max: 0.52,
    step: 0.02,
    default: def,
  };
}

export function wingLever(def: number): LeverSpec {
  return {
    id: 'wing',
    label: 'Wing',
    quantity: 'angle_int',
    min: 0,
    max: 8,
    step: 1,
    default: def,
  };
}

// ---- Rule helpers (pure, over RunSummary) ----

/**
 * The peak-grip slip ratio with a hair of float tolerance: at the limit a gripping tyre sits at
 * exactly this slip (stored as float32), and anything above it is sliding rubber.
 */
export const SLIP_LIMIT = 0.1;
export const SLIDING = (v: number): boolean => v > SLIP_LIMIT + 1e-3;

/** Grip used at or above this counts as "at the limit". */
export const AT_LIMIT = 0.97;

/** The level's effective car. */
export function carOf(level: LevelConfig): CarParams {
  return { ...DEFAULT_CAR, ...level.car };
}

/** Clean max of a channel (NaN if the channel is absent). */
export function cleanMax(s: RunSummary, id: ChannelId): number {
  return s.clean[id]?.max ?? NaN;
}

/** Clean min of a channel (NaN if the channel is absent). */
export function cleanMin(s: RunSummary, id: ChannelId): number {
  return s.clean[id]?.min ?? NaN;
}

export type Window = { tStart: number; tEnd: number };

/** First/last time the brake is applied, or null on a run without braking. */
export function brakeWindow(s: RunSummary): Window | null {
  return s.window('brake', (v) => v > 0.01);
}

/** The throttle-ramp window: from the start until the throttle first reaches full. */
export function rampWindow(s: RunSummary): Window | null {
  const full = s.window('throttle', (v) => v >= 0.999);
  return full ? { tStart: 0, tEnd: full.tStart } : null;
}

/**
 * Peak of `id` over the samples at or before `tCut` (or at/after when `after`), found by bisection
 * on `window()` thresholds. Accurate to ~1e-4 of the channel's range. NaN when `id` is absent.
 */
export function peakInPhase(s: RunSummary, id: ChannelId, tCut: number, after = false): number {
  const st = s.clean[id];
  if (!st) return NaN;
  const inPhase = (x: number): boolean => {
    const w = s.window(id, (v) => v > x);
    if (!w) return false;
    return after ? w.tEnd >= tCut : w.tStart <= tCut;
  };
  let lo = st.min;
  let hi = st.max;
  if (!inPhase(lo - 1e-9)) return NaN;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inPhase(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Window where `id` is sliding (above the peak-grip slip), clipped to a phase. */
export function slidingWindow(s: RunSummary, id: ChannelId): Window | null {
  return s.window(id, SLIDING);
}

/**
 * μ at this pressure as a fraction of μ at the optimum pressure, from the car's pressure bell.
 * 1 when pressure does not affect grip on this level.
 */
export function pressureGripRatio(ctx: HintCtx): number {
  if (!ctx.level.flags.pressureAffectsGrip) return 1;
  const car = carOf(ctx.level);
  const x = (ctx.setup.tire_pressure - car.pOpt) / car.sigmaP;
  return Math.exp(-x * x);
}

/** Sign of the pressure error: +1 over the optimum, −1 under it. */
export function pressureDirection(ctx: HintCtx): 1 | -1 {
  return ctx.setup.tire_pressure > carOf(ctx.level).pOpt ? 1 : -1;
}

/** The level's lever spec by id (throws if not unlocked; rules only reference unlocked levers). */
export function lever(level: LevelConfig, id: LeverSpec['id']): LeverSpec {
  const l = level.levers.find((x) => x.id === id);
  if (!l) throw new Error(`level ${level.id} has no lever ${id}`);
  return l;
}

/** Assigns every id in `ids` the given role (for building `channelRoles`). */
export function roles<R extends string>(r: R, ids: ChannelId[]): Record<ChannelId, R> {
  return Object.fromEntries(ids.map((id) => [id, r]));
}
