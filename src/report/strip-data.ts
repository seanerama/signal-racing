/**
 * Builds a strip's uPlot data: `[x, ...history, best, current]`, all on the current run's x and
 * converted to display units. The best run (and each history run) is resampled onto the current
 * run's x (`align.ts`). Dropouts (NaN) become `null`, which uPlot draws as gaps. With `smooth`
 * (Stage 9) the current and best lines are the display-only 5-point mean (`smooth.ts`).
 */
import type uPlot from 'uplot';
import type { ChannelId, Quantity } from '@/engine/types';
import type { RunTelemetry } from '@/telemetry/types';
import { toDisplay, type UnitSystem } from '@/units';
import { interpAt, resampleOnto } from './align';
import { smooth5 } from './smooth';

export type Axis = 'time' | 'distance';

/** The x array of a run on the given axis, in display units. */
export function axisX(rt: RunTelemetry, axis: Axis, units: UnitSystem): Float64Array {
  const src = axis === 'time' ? rt.t : rt.s;
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = axis === 'time' ? (src[i] as number) : toDisplay('distance', units, src[i] as number);
  }
  return out;
}

/** An SI axis value (s or m) → display axis units. */
export function axisValue(v: number, axis: Axis, units: UnitSystem): number {
  return axis === 'time' ? v : toDisplay('distance', units, v);
}

/** A time (s) in the current run → display axis units (distance mode maps t → s). */
export function timeToAxis(rt: RunTelemetry, t: number, axis: Axis, units: UnitSystem): number {
  if (axis === 'time') return t;
  const s = interpAt(rt.t, rt.s, Math.max(rt.t[0] ?? 0, Math.min(rt.t[rt.n - 1] ?? 0, t)));
  return toDisplay('distance', units, s);
}

function toDisplayArray(q: Quantity, units: UnitSystem, ys: ArrayLike<number>): Float64Array {
  const out = new Float64Array(ys.length);
  for (let i = 0; i < ys.length; i++) out[i] = toDisplay(q, units, ys[i] as number);
  return out;
}

function gapped(a: ArrayLike<number>): (number | null)[] {
  const out = new Array<number | null>(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = a[i] as number;
    out[i] = Number.isFinite(v) ? v : null;
  }
  return out;
}

function runAxisSrc(rt: RunTelemetry, axis: Axis): Float32Array {
  return axis === 'time' ? rt.t : rt.s;
}

export interface StripData {
  data: uPlot.AlignedData;
  /** Display-unit values, indexed by current-run sample (for the readout). */
  cur: Float64Array;
  best: Float64Array | null;
  x: Float64Array;
  historyCount: number;
}

/**
 * Time-axis tail (Stage 10): when the reference run lasts longer than the current one, its
 * extra samples are appended to the x array (the current series is a gap there), so the x-range
 * covers max(current, best) duration and the reference is drawn in full.
 */
function bestTail(current: RunTelemetry, best: RunTelemetry | null, axis: Axis): number[] {
  if (axis !== 'time' || !best || best.n === 0 || current.n === 0) return [];
  const end = current.t[current.n - 1] as number;
  const out: number[] = [];
  for (let i = 0; i < best.n; i++) {
    const t = best.t[i] as number;
    if (t > end + 1e-9) out.push(i);
  }
  return out;
}

export function buildStripData(args: {
  id: ChannelId;
  quantity: Quantity;
  current: RunTelemetry;
  best: RunTelemetry | null;
  history?: RunTelemetry[];
  axis: Axis;
  units: UnitSystem;
  /** Stage 9: display-only 5-point centred mean on the current and best lines. */
  smooth?: boolean;
}): StripData {
  const { id, quantity, current, best, axis, units } = args;
  const sm = args.smooth ? smooth5 : (a: Float64Array) => a;
  const x = axisX(current, axis, units);
  const dstSi = runAxisSrc(current, axis);
  const has = (rt: RunTelemetry) => rt.channelIds.includes(id);
  const cur = sm(toDisplayArray(quantity, units, has(current) ? current.get(id) : []));
  const resample = (rt: RunTelemetry) =>
    toDisplayArray(quantity, units, resampleOnto(runAxisSrc(rt, axis), rt.get(id), dstSi));
  const bestArr = best && has(best) ? sm(resample(best)) : null;
  const hist = (args.history ?? []).filter((h) => h !== current && h !== best && has(h));
  const n = x.length;
  const curLine = gapped(cur.length === n ? cur : new Float64Array(n).fill(NaN));
  const bestLine = gapped(bestArr ?? new Float64Array(n).fill(NaN));
  const histLines = hist.map((h) => gapped(resample(h)));

  const tail = bestTail(current, best, axis);
  let xs: Float64Array = x;
  if (tail.length > 0 && best) {
    xs = new Float64Array(n + tail.length);
    xs.set(x);
    const bestVals = has(best) ? sm(toDisplayArray(quantity, units, best.get(id))) : null;
    tail.forEach((bi, k) => {
      xs[n + k] = best.t[bi] as number;
      curLine.push(null);
      const v = bestVals ? (bestVals[bi] as number) : NaN;
      bestLine.push(Number.isFinite(v) ? v : null);
      for (const h of histLines) h.push(null);
    });
  }
  const data: uPlot.AlignedData = [xs, ...histLines, bestLine, curLine] as uPlot.AlignedData;
  return { data, cur, best: bestArr, x: xs, historyCount: hist.length };
}
