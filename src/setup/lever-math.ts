/**
 * Pure lever arithmetic for the discrete lever widget: step grids built from integers (so
 * `0.2·3 = 0.6` exactly), snapping, stepping, and parsing a typed display value back to SI.
 */
import type { LeverSpec } from '@/levels/types';
import { fromDisplay, type UnitSystem } from '@/units';

function decimals(x: number): number {
  const s = String(x);
  if (s.includes('e-')) return Number(s.split('e-')[1] ?? 0);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Number of steps on the lever (ticks − 1). */
export function stepCount(l: LeverSpec): number {
  return Math.round((l.max - l.min) / l.step);
}

/** Value of tick `i` (clamped to the grid). */
export function valueAt(l: LeverSpec, i: number): number {
  const k = Math.max(0, Math.min(stepCount(l), Math.round(i)));
  const dp = Math.max(decimals(l.step), decimals(l.min));
  return Number((l.min + k * l.step).toFixed(dp));
}

/** Index of the tick nearest `v`. */
export function indexOf(l: LeverSpec, v: number): number {
  return Math.max(0, Math.min(stepCount(l), Math.round((v - l.min) / l.step)));
}

/** Snaps `v` onto the grid (clamped to the range). */
export function snap(l: LeverSpec, v: number): number {
  return valueAt(l, indexOf(l, v));
}

/** Moves `delta` ticks from `v`. */
export function stepBy(l: LeverSpec, v: number, delta: number): number {
  return valueAt(l, indexOf(l, v) + delta);
}

/** Fraction along the track (0–1) for a value. */
export function fractionOf(l: LeverSpec, v: number): number {
  const n = stepCount(l);
  return n === 0 ? 0 : indexOf(l, v) / n;
}

/**
 * Parses a typed value in display units. Returns the SI grid value, or null when the text is not
 * a number, lies outside the range (with half a step of slack), or does not land on a step.
 */
export function parseTyped(l: LeverSpec, text: string, units: UnitSystem): number | null {
  const cleaned = text
    .trim()
    .replace(',', '.')
    .replace(/[^\d.+-]+$/u, '')
    .trim();
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const si = fromDisplay(l.quantity, units, Number(cleaned));
  if (!Number.isFinite(si)) return null;
  if (si < l.min - l.step / 2 || si > l.max + l.step / 2) return null;
  const snapped = snap(l, si);
  // Must land on a step (to display precision): a typed 0.5 on a 0.2 grid is invalid.
  if (Math.abs(snapped - si) > l.step * 0.26) return null;
  return snapped;
}
