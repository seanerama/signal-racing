/**
 * Hint window band (design-system "Strip"): an `--accent-dim` band across the plot height with a
 * 1px `--accent` top edge, on ONLY the strip the hint names. Drawn at the start of each redraw,
 * so the traces sit on top of it.
 */
import type uPlot from 'uplot';
import { cssVar } from '../uplot-theme';

/** `getRange` returns the window in x-axis units, or null for no band. */
export function hintBandPlugin(getRange: () => [number, number] | null): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u: uPlot) => {
        const range = getRange();
        if (!range) return;
        const { left, top, width, height } = u.bbox;
        const a = u.valToPos(Math.min(range[0], range[1]), 'x', true);
        const b = u.valToPos(Math.max(range[0], range[1]), 'x', true);
        const x0 = Math.max(left, Math.min(left + width, a));
        const x1 = Math.max(left, Math.min(left + width, b));
        if (!(x1 > x0)) return;
        const ctx = u.ctx;
        ctx.save();
        ctx.fillStyle = cssVar('--accent-dim');
        ctx.fillRect(x0, top, x1 - x0, height);
        ctx.fillStyle = cssVar('--accent');
        ctx.fillRect(x0, top, x1 - x0, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
        ctx.restore();
      },
    },
  };
}
