/**
 * Axis helpers shared by both views: nice ticks mapped into scene units, labels with units.
 * Pure (no three.js, no DOM).
 */
import type { Setup } from '@/engine/types';
import type { LeverSpec } from '@/levels/types';
import { LEVER_SHORT } from '@/report/ResultHeader';
import { formatTick, niceStep } from '@/report/uplot-theme';
import { formatValue, type UnitSystem } from '@/units';

export interface AxisTick {
  /** Position along the axis, in scene units. */
  pos: number;
  label: string;
}

/** Linear map `[min, max]` → `[0, len]` (a flat range maps to the middle). */
export function scaler(min: number, max: number, len: number): (v: number) => number {
  const span = max - min;
  if (!(span > 0)) return () => len / 2;
  return (v) => ((v - min) / span) * len;
}

/** About `count` nice ticks inside `[min, max]`, placed by `map`. */
export function niceTicks(
  min: number,
  max: number,
  count: number,
  map: (v: number) => number,
): AxisTick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [{ pos: map(min), label: formatTick(min, 1) }];
  const step = niceStep(max - min, count);
  const out: AxisTick[] = [];
  const start = Math.ceil(min / step - 1e-9) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) {
    const val = +v.toPrecision(12);
    out.push({ pos: map(val), label: formatTick(val, step) });
  }
  return out;
}

/** `[min, max]` padded by `frac` of the span (a flat range gets ±0.5 or ±5%). */
export function padRange(min: number, max: number, frac = 0.05): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max === min) {
    const pad = Math.abs(min) * 0.05 || 0.5;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * frac;
  return [min - pad, max + pad];
}

/** `ramp 0.40 s · pressure 1.70 bar`: the unlocked levers of a setup, as compact chips. */
export function setupChipText(
  setup: Setup,
  levers: readonly LeverSpec[],
  units: UnitSystem,
): string {
  return levers
    .map((l) => `${LEVER_SHORT[l.id] ?? l.id} ${formatValue(l.quantity, units, setup[l.id])}`)
    .join(' · ');
}

/** `throttle_ramp · s` style axis title: id plus display unit (unitless: id only). */
export function axisTitle(name: string, unit: string): string {
  return unit ? `${name} · ${unit}` : name;
}
