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
  const data: uPlot.AlignedData = [
    x,
    ...hist.map((h) => gapped(resample(h))),
    gapped(bestArr ?? new Float64Array(x.length).fill(NaN)),
    gapped(cur.length === x.length ? cur : new Float64Array(x.length).fill(NaN)),
  ] as uPlot.AlignedData;
  return { data, cur, best: bestArr, x, historyCount: hist.length };
}
