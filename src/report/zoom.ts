/**
 * Shared x-range zoom (design-system "Cursor"): Shift+drag on any strip zooms every strip;
 * double-click resets. The range lives in a module signal so it survives strip rebuilds and
 * persists while comparing runs within a level. It is keyed by the axis frame (axis mode +
 * unit system) because the x values are in display units: a zoom from another frame is ignored.
 */
import { signal, type Signal } from '@preact/signals';
import type uPlot from 'uplot';

export interface XZoom {
  /** `${axis}:${units}`; the frame the range is expressed in. */
  frame: string;
  min: number;
  max: number;
}

export const xZoom: Signal<XZoom | null> = signal<XZoom | null>(null);

export function zoomFrame(axis: 'time' | 'distance', units: string): string {
  return `${axis}:${units}`;
}

/** Sets the shared zoom. Ignores degenerate or inverted ranges. */
export function setZoom(frame: string, a: number, b: number): void {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= 0) return;
  const cur = xZoom.value;
  if (cur && cur.frame === frame && cur.min === min && cur.max === max) return;
  xZoom.value = { frame, min, max };
}

export function resetZoom(): void {
  xZoom.value = null;
}

/** The active range for `frame`, or null (full extent). */
export function zoomFor(frame: string, z: XZoom | null = xZoom.value): [number, number] | null {
  return z && z.frame === frame ? [z.min, z.max] : null;
}

/** `setSelect` hook: a finished Shift+drag sets the shared zoom; the selection box is cleared. */
export function onPlotSelect(u: uPlot, frame: string): void {
  const { left, width } = u.select;
  if (width > 2) setZoom(frame, u.posToVal(left, 'x'), u.posToVal(left + width, 'x'));
  u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
}

/** Applies a zoom range to one plot, or restores the full extent of `xs`. */
export function applyZoom(u: uPlot, range: [number, number] | null, xs: ArrayLike<number>): void {
  const n = xs.length;
  if (n === 0) return;
  const [min, max] = range ?? [xs[0] as number, xs[n - 1] as number];
  if (!(max > min)) return;
  const sc = u.scales['x'];
  if (sc && sc.min === min && sc.max === max) return;
  u.setScale('x', { min, max });
}
