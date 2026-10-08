/**
 * Run waterfall geometry, as pure data (no three.js, no DOM; unit-tested).
 *
 * x = time or distance (display units), y = channel value (display units), z = run index with the
 * oldest run at the back. One ribbon per run. Older runs are shaded on the viridis ramp by age,
 * the current (latest) run uses its strip's slot hue and the best run uses `--best`.
 *
 * Scene units: the plot box is `BOX_W × BOX_H × depth`, with the floor at y = 0, x from 0 to
 * `BOX_W` and the newest run at z = 0 (depth grows toward −z).
 */
import type { ChannelId, Quantity, Setup } from '@/engine/types';
import type { RunTelemetry } from '@/telemetry/types';
import { toDisplay, unitLabel, type UnitSystem } from '@/units';
import { axisTitle, niceTicks, padRange, scaler, type AxisTick } from './axes';
import { ageColors } from './colors';
import type { AxisMode } from './types';

export const BOX_W = 2.4;
export const BOX_H = 0.9;
/** Total depth budget for the run axis; each gap is clamped to `[DZ_MIN, DZ_MAX]`. */
export const DEPTH = 1.6;
export const DZ_MIN = 0.1;
export const DZ_MAX = 0.32;
/** Points per ribbon after stride decimation (a run is ~10–60 s at 100 Hz). */
export const MAX_POINTS = 800;

/** The parts of a `RunRecord` the waterfall reads. */
export interface WaterfallRun {
  index: number;
  setup: Setup;
  outcome: { totalTime: number; finished: boolean };
  telemetry: Pick<RunTelemetry, 'n' | 't' | 's' | 'get'>;
}

export type RibbonRole = 'history' | 'current' | 'best';

export interface Ribbon {
  runIndex: number;
  role: RibbonRole;
  /** True for the best run even when it is also the current one. */
  isBest: boolean;
  color: string;
  /** Scene z of this run's slot. */
  z: number;
  /** Runs of finite samples as xyz triples (dropouts split a ribbon into pieces). */
  pieces: Float32Array[];
}

export interface WaterfallModel {
  /** Oldest first. */
  ribbons: Ribbon[];
  box: { w: number; h: number; d: number };
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  /** Run labels along z (`RUN n`), oldest first. */
  zTicks: AxisTick[];
  xTitle: string;
  yTitle: string;
  currentIndex: number | null;
  bestIndex: number | null;
}

export interface WaterfallInput {
  runs: readonly WaterfallRun[];
  channel: ChannelId;
  quantity: Quantity;
  units: UnitSystem;
  axis: AxisMode;
  /** Current-run colour (slot hue). */
  currentColor: string;
  /** `--best`. */
  bestColor: string;
  /** The viridis ramp (`--seq-0…8`). */
  ramp: readonly string[];
  /** `index` of the best run; default: the fastest finished run. */
  bestIndex?: number | null;
}

/** The fastest finished run's `index`, or null. */
export function fastestRun(runs: readonly WaterfallRun[]): number | null {
  let best: WaterfallRun | null = null;
  for (const r of runs) {
    if (!r.outcome.finished || !Number.isFinite(r.outcome.totalTime)) continue;
    if (!best || r.outcome.totalTime < best.outcome.totalTime) best = r;
  }
  return best ? best.index : null;
}

/** Gap between run slots along z. */
export function runSpacing(count: number): number {
  if (count <= 1) return 0;
  return Math.max(DZ_MIN, Math.min(DZ_MAX, DEPTH / (count - 1)));
}

/** Indices `0, k, 2k, …, n−1` with `k` chosen so at most `max` points remain. */
export function strideIndices(n: number, max = MAX_POINTS): number[] {
  if (n <= 0) return [];
  const k = Math.max(1, Math.ceil(n / max));
  const out: number[] = [];
  for (let i = 0; i < n; i += k) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}

/** Splits `(x, y)` samples at non-finite values into pieces of ≥ 2 points. */
export function splitFinite(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  idx: readonly number[],
): Array<Array<[number, number]>> {
  const pieces: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  for (const i of idx) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    if (Number.isFinite(x) && Number.isFinite(y)) cur.push([x, y]);
    else {
      if (cur.length >= 2) pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) pieces.push(cur);
  return pieces;
}

export function buildWaterfall(input: WaterfallInput): WaterfallModel {
  const { channel, quantity, units, axis } = input;
  const runs = [...input.runs].sort((a, b) => a.index - b.index);
  const n = runs.length;
  const dz = runSpacing(n);
  const depth = dz * Math.max(0, n - 1);
  const currentIndex = n > 0 ? (runs[n - 1] as WaterfallRun).index : null;
  const bestIndex = input.bestIndex === undefined ? fastestRun(runs) : input.bestIndex;
  const xq: Quantity = axis === 'time' ? 'time' : 'distance';

  // Display-unit samples per run, and the shared ranges.
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const series = runs.map((r) => {
    const tel = r.telemetry;
    const src = axis === 'time' ? tel.t : tel.s;
    const raw = tel.get(channel);
    const idx = strideIndices(Math.min(tel.n, src.length, raw.length));
    const xs = new Float64Array(src.length);
    const ys = new Float64Array(raw.length);
    for (const i of idx) {
      const x = toDisplay(xq, units, src[i] as number);
      const y = toDisplay(quantity, units, raw[i] as number);
      xs[i] = x;
      ys[i] = y;
      if (Number.isFinite(x)) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
      if (Number.isFinite(y)) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    return { run: r, xs, ys, idx };
  });
  if (!(xMin <= xMax)) {
    xMin = 0;
    xMax = 1;
  }
  const [y0, y1] = yMin <= yMax ? padRange(yMin, yMax) : [0, 1];
  const mapX = scaler(xMin, xMax, BOX_W);
  const mapY = scaler(y0, y1, BOX_H);

  // Older runs (neither current nor best) get the age ramp, oldest darkest.
  const historyRuns = runs.filter((r) => r.index !== currentIndex && r.index !== bestIndex);
  const ages = ageColors(historyRuns.length, input.ramp);
  const ageOf = new Map(historyRuns.map((r, i) => [r.index, ages[i] as string]));

  const ribbons: Ribbon[] = series.map(({ run, xs, ys, idx }, k) => {
    const z = -((n - 1 - k) * dz) || 0; // newest at exactly 0 (not −0)
    const isBest = run.index === bestIndex;
    const role: RibbonRole = run.index === currentIndex ? 'current' : isBest ? 'best' : 'history';
    const color =
      role === 'current'
        ? input.currentColor
        : role === 'best'
          ? input.bestColor
          : (ageOf.get(run.index) as string);
    const pieces = splitFinite(xs, ys, idx).map((pts) => {
      const arr = new Float32Array(pts.length * 3);
      pts.forEach(([x, y], j) => {
        arr[j * 3] = mapX(x);
        arr[j * 3 + 1] = mapY(y);
        arr[j * 3 + 2] = z;
      });
      return arr;
    });
    return { runIndex: run.index, role, isBest, color, z, pieces };
  });

  return {
    ribbons,
    box: { w: BOX_W, h: BOX_H, d: depth },
    xTicks: niceTicks(xMin, xMax, 6, mapX),
    yTicks: niceTicks(y0, y1, 4, mapY).filter((t) => t.pos >= -1e-6 && t.pos <= BOX_H + 1e-6),
    zTicks: ribbons.map((r) => ({ pos: r.z, label: `RUN ${r.runIndex}` })),
    xTitle: axisTitle(axis === 'time' ? 't' : 's', unitLabel(xq, units)),
    yTitle: axisTitle(channel, unitLabel(quantity, units)),
    currentIndex,
    bestIndex,
  };
}
