/**
 * Response-surface geometry, as pure data (no three.js, no DOM; unit-tested).
 *
 * From `GridResult.samples`: pick the two unlocked levers with the largest marginal range of the
 * outcome (for each step value, the best time reachable with any other lever values; range =
 * max − min of those). Their step grid becomes x and z; y is the outcome time with the other
 * levers fixed at the optimum. Cells the grid search never evaluated (coarse + fine passes on big
 * levels) are filled by inverse-distance weighting of the nearest evaluated points in normalised
 * step space, and the legend says how many.
 *
 * With one unlocked lever (A1) the model is a 2D curve in the same scene (`kind: 'curve'`).
 *
 * Scene units: x ∈ [0, SURF_W], z ∈ [0, SURF_D] (lever B grows toward +z), y ∈ [0, SURF_H] with
 * the floor at 0 = the fastest time in view.
 */
import type { LeverId, Setup } from '@/engine/types';
import type { LeverSpec } from '@/levels/types';
import { toDisplay, unitLabel, type UnitSystem } from '@/units';
import { axisTitle, niceTicks, padRange, scaler, type AxisTick } from './axes';
import { rampColor } from './colors';

export const SURF_W = 2;
export const SURF_D = 2;
export const SURF_H = 1;
/** Most tick labels per lever axis (every step keeps a grid line). */
export const MAX_LEVER_LABELS = 11;
/** Neighbours for the inverse-distance fill. */
export const IDW_K = 4;

export interface Sample {
  setup: Setup;
  totalTime: number;
}

/** The parts of a `RunRecord` the surface reads. */
export interface SurfaceRun {
  index: number;
  setup: Setup;
  outcome: { totalTime: number; finished: boolean };
}

/** Step values of a lever, `min` to `max` inclusive. */
export function stepValues(l: LeverSpec): number[] {
  if (!(l.step > 0) || !(l.max >= l.min)) return [l.min];
  const n = Math.round((l.max - l.min) / l.step);
  return Array.from({ length: n + 1 }, (_, i) => +(l.min + i * l.step).toPrecision(12));
}

/** Nearest step index of `v` on lever `l` (clamped). */
export function stepIndex(l: LeverSpec, v: number): number {
  const n = Math.round((l.max - l.min) / l.step);
  return Math.max(0, Math.min(n, Math.round((v - l.min) / l.step)));
}

/** Per lever: max − min over step values of the best time reachable at that value. */
export function marginalRanges(
  levers: readonly LeverSpec[],
  samples: readonly Sample[],
): Map<LeverId, number> {
  const out = new Map<LeverId, number>();
  for (const l of levers) {
    const best = new Map<number, number>();
    for (const s of samples) {
      if (!Number.isFinite(s.totalTime)) continue;
      const k = stepIndex(l, s.setup[l.id]);
      const prev = best.get(k);
      if (prev === undefined || s.totalTime < prev) best.set(k, s.totalTime);
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of best.values()) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    out.set(l.id, best.size > 1 ? hi - lo : 0);
  }
  return out;
}

/**
 * The (up to) two most influential unlocked levers, by marginal range, in level order.
 * Ties keep level order. One lever in → one lever out. A level's `surfaceLevers` (Stage 11:
 * the axes its lesson is about) win when both are unlocked, in the order given.
 */
export function pickLeverPair(
  levers: readonly LeverSpec[],
  samples: readonly Sample[],
  preferred?: readonly [LeverId, LeverId],
): LeverSpec[] {
  if (preferred) {
    const a = levers.find((l) => l.id === preferred[0]);
    const b = levers.find((l) => l.id === preferred[1]);
    if (a && b && a !== b) return [a, b];
  }
  if (levers.length <= 2) return [...levers];
  const r = marginalRanges(levers, samples);
  const ranked = levers
    .map((l, i) => ({ l, i, v: r.get(l.id) ?? 0 }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i);
  return ranked.map((x) => x.l);
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface SurfaceRunDot extends Point3 {
  index: number;
  time: number;
}

interface ModelBase {
  /** Levers on x (and z for a surface). */
  levers: LeverSpec[];
  box: { w: number; h: number; d: number };
  xTicks: AxisTick[];
  /** Every lever step on x, in scene units (floor grid lines). */
  xSteps: number[];
  yTicks: AxisTick[];
  xTitle: string;
  yTitle: string;
  /** Finished player runs in order, positioned in the scene. */
  runs: SurfaceRunDot[];
  optimum: Point3 & { time: number };
  /** y range in seconds (floor, top). */
  yRange: [number, number];
  /** Time (s) at the coloured extremes: `ramp[8]` = fast, `ramp[0]` = slow. */
  colorRange: [number, number];
  /** Unlocked levers held at the optimum (not on an axis). */
  fixed: Array<{ lever: LeverSpec; value: number }>;
}

export interface SurfaceModel extends ModelBase {
  kind: 'surface';
  nx: number;
  nz: number;
  /** nx·nz vertices, row-major by z then x: xyz triples. */
  positions: Float32Array;
  /** Per-vertex rgb (0–1). */
  colors: Float32Array;
  /** Outcome time per vertex (s). */
  times: Float64Array;
  zTicks: AxisTick[];
  zSteps: number[];
  zTitle: string;
  /** Cells filled by interpolation, out of `nx·nz`. */
  interpolated: number;
}

export interface CurveModel extends ModelBase {
  kind: 'curve';
  /** xyz triples along lever x (z = 0). */
  positions: Float32Array;
  colors: Float32Array;
  times: Float64Array;
  interpolated: number;
}

export type ResponseModel = SurfaceModel | CurveModel;

export interface SurfaceInput {
  levers: readonly LeverSpec[];
  samples: readonly Sample[];
  optimum: { setup: Setup; totalTime: number };
  runs: readonly SurfaceRun[];
  units: UnitSystem;
  ramp: readonly string[];
  /** Stage 11: the level's chosen surface axes (`LevelConfig.surfaceLevers`), if any. */
  surfaceLevers?: readonly [LeverId, LeverId];
}

function rgb(css: string): [number, number, number] {
  const m = css.match(/\d+/g) ?? [];
  return [Number(m[0] ?? 0) / 255, Number(m[1] ?? 0) / 255, Number(m[2] ?? 0) / 255];
}

/**
 * Outcome time at the step-index vector `target` (one entry per lever). Exact sample if
 * evaluated; otherwise inverse-distance weighting of the `IDW_K` nearest samples in normalised
 * step space. Returns `[time, interpolated]`.
 */
export function makeLookup(
  levers: readonly LeverSpec[],
  samples: readonly Sample[],
): (target: number[]) => [number, boolean] {
  const spans = levers.map((l) => Math.max(1, Math.round((l.max - l.min) / l.step)));
  const keyed = new Map<string, number>();
  const pts: Array<{ v: number[]; t: number }> = [];
  for (const s of samples) {
    if (!Number.isFinite(s.totalTime)) continue;
    const v = levers.map((l) => stepIndex(l, s.setup[l.id]));
    const key = v.join(',');
    const prev = keyed.get(key);
    if (prev === undefined || s.totalTime < prev) keyed.set(key, s.totalTime);
    pts.push({ v, t: s.totalTime });
  }
  return (target) => {
    const exact = keyed.get(target.join(','));
    if (exact !== undefined) return [exact, false];
    if (pts.length === 0) return [NaN, true];
    // k nearest (k is tiny: keep a sorted short list).
    const near: Array<{ d: number; t: number }> = [];
    for (const p of pts) {
      let d = 0;
      for (let i = 0; i < target.length; i++) {
        const di = ((p.v[i] as number) - (target[i] as number)) / (spans[i] as number);
        d += di * di;
      }
      if (near.length < IDW_K || d < (near[near.length - 1] as { d: number }).d) {
        near.push({ d, t: p.t });
        near.sort((a, b) => a.d - b.d);
        if (near.length > IDW_K) near.pop();
      }
    }
    let wsum = 0;
    let tsum = 0;
    for (const { d, t } of near) {
      const w = 1 / Math.max(d, 1e-12);
      wsum += w;
      tsum += w * t;
    }
    return [tsum / wsum, true];
  };
}

/**
 * Decimals for a lever's tick labels: enough to tell adjacent steps apart in display units
 * (0.1 s → 1 dp; 0.1 bar → 1 dp; 1.45 psi → 1 dp).
 */
export function stepDecimals(l: LeverSpec, units: UnitSystem): number {
  const step = Math.abs(
    toDisplay(l.quantity, units, l.min + l.step) - toDisplay(l.quantity, units, l.min),
  );
  if (!(step > 0)) return 0;
  let dp = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  // One more decimal when the step is not a whole number of units at that precision.
  if (Math.abs(step * 10 ** dp - Math.round(step * 10 ** dp)) > 1e-6) dp++;
  dp = Math.min(3, dp);
  return dp;
}

/** Tick labels at the lever's discrete steps, thinned to at most `MAX_LEVER_LABELS`. */
export function leverTicks(
  l: LeverSpec,
  units: UnitSystem,
  map: (si: number) => number,
): AxisTick[] {
  const steps = stepValues(l);
  const every = Math.max(1, Math.ceil((steps.length - 1) / (MAX_LEVER_LABELS - 1)));
  const dp = stepDecimals(l, units);
  const out: AxisTick[] = [];
  steps.forEach((v, i) => {
    if (i % every !== 0) return;
    out.push({ pos: map(v), label: toDisplay(l.quantity, units, v).toFixed(dp) });
  });
  return out;
}

export function buildResponse(input: SurfaceInput): ResponseModel {
  const { levers, samples, optimum, units, ramp } = input;
  const axes = pickLeverPair(levers, samples, input.surfaceLevers);
  const others = levers.filter((l) => !axes.includes(l));
  const lookup = makeLookup(levers, samples);
  const optIdx = levers.map((l) => stepIndex(l, optimum.setup[l.id]));
  const pos = new Map(levers.map((l, i) => [l.id, i]));

  const la = axes[0] as LeverSpec;
  const lb = axes[1];
  const xsSi = stepValues(la);
  const zsSi = lb ? stepValues(lb) : [0];
  const nx = xsSi.length;
  const nz = zsSi.length;

  const times = new Float64Array(nx * nz);
  let interpolated = 0;
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const target = [...optIdx];
      target[pos.get(la.id) as number] = i;
      if (lb) target[pos.get(lb.id) as number] = k;
      const [t, interp] = lookup(target);
      times[k * nx + i] = t;
      if (interp) interpolated++;
    }
  }

  const finishedRuns = input.runs
    .filter((r) => r.outcome.finished && Number.isFinite(r.outcome.totalTime))
    .sort((a, b) => a.index - b.index);

  let tMin = Infinity;
  let tMax = -Infinity;
  for (const t of times) {
    if (!Number.isFinite(t)) continue;
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
  }
  const colorRange: [number, number] = tMin <= tMax ? [tMin, tMax] : [0, 1];
  for (const r of finishedRuns) {
    tMin = Math.min(tMin, r.outcome.totalTime);
    tMax = Math.max(tMax, r.outcome.totalTime);
  }
  tMin = Math.min(tMin, optimum.totalTime);
  tMax = Math.max(tMax, optimum.totalTime);
  // Floor sits just under the fastest point so dots on the floor stay visible.
  const [y0, y1] = padRange(tMin, tMax, 0.04);
  const mapY = scaler(y0, y1, SURF_H);
  const mapX = scaler(la.min, la.max, SURF_W);
  const mapZ = lb ? scaler(lb.min, lb.max, SURF_D) : () => 0;

  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const j = k * nx + i;
      const t = times[j] as number;
      positions[j * 3] = mapX(xsSi[i] as number);
      positions[j * 3 + 1] = Number.isFinite(t) ? mapY(t) : 0;
      positions[j * 3 + 2] = mapZ(zsSi[k] as number);
      // Fast = bright (ramp top), so the optimum diamond (--best) reads against it.
      const c = rgb(
        rampColor(1 - (t - colorRange[0]) / (colorRange[1] - colorRange[0] || 1), ramp),
      );
      colors.set(c, j * 3);
    }
  }

  const place = (setup: Setup, time: number): Point3 => ({
    x: mapX(setup[la.id]),
    y: mapY(time),
    z: lb ? mapZ(setup[lb.id]) : 0,
  });

  const timeUnit = unitLabel('time', units);
  const base: ModelBase = {
    levers: axes,
    box: { w: SURF_W, h: SURF_H, d: lb ? SURF_D : 0 },
    xTicks: leverTicks(la, units, mapX),
    xSteps: xsSi.map(mapX),
    yTicks: niceTicks(y0, y1, 4, mapY).filter((t) => t.pos >= -1e-6 && t.pos <= SURF_H + 1e-6),
    xTitle: axisTitle(la.id, unitLabel(la.quantity, units)),
    yTitle: axisTitle('time', timeUnit),
    runs: finishedRuns.map((r) => ({
      index: r.index,
      time: r.outcome.totalTime,
      ...place(r.setup, r.outcome.totalTime),
    })),
    optimum: { ...place(optimum.setup, optimum.totalTime), time: optimum.totalTime },
    yRange: [y0, y1],
    colorRange,
    fixed: others.map((l) => ({ lever: l, value: optimum.setup[l.id] })),
  };

  if (!lb) return { ...base, kind: 'curve', positions, colors, times, interpolated };
  return {
    ...base,
    kind: 'surface',
    nx,
    nz,
    positions,
    colors,
    times,
    zTicks: leverTicks(lb, units, mapZ),
    zSteps: zsSi.map(mapZ),
    zTitle: axisTitle(lb.id, unitLabel(lb.quantity, units)),
    interpolated,
  };
}
