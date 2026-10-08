/**
 * Segment boundaries (design-system "Strip", Phase B): full-height dashed `--rule` lines through
 * every strip, with segment labels on the bottom strip only. Drawn after the axes and before the
 * series, so traces stay on top.
 */
import type uPlot from 'uplot';
import { cssPx, cssVar } from '../uplot-theme';

export interface SegmentRulesConfig {
  /** Boundaries in x-axis units (the start of each segment after the first). */
  boundaries: number[];
  /** Labels per segment (`boundaries.length + 1` of them); drawn only when `showLabels`. */
  labels?: string[];
  showLabels: boolean;
}

export function segmentRulesPlugin(getConfig: () => SegmentRulesConfig | null): uPlot.Plugin {
  return {
    hooks: {
      drawAxes: (u: uPlot) => {
        const cfg = getConfig();
        if (!cfg || (cfg.boundaries.length === 0 && !cfg.showLabels)) return;
        const pr = globalThis.devicePixelRatio || 1;
        const { left, top, width, height } = u.bbox;
        const xMin = u.scales.x?.min ?? -Infinity;
        const xMax = u.scales.x?.max ?? Infinity;
        const ctx = u.ctx;
        ctx.save();
        ctx.strokeStyle = cssVar('--rule');
        ctx.lineWidth = pr;
        ctx.setLineDash([4 * pr, 4 * pr]);
        for (const b of cfg.boundaries) {
          if (b <= xMin || b >= xMax) continue;
          const x = Math.round(u.valToPos(b, 'x', true)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + height);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        if (cfg.showLabels && cfg.labels && cfg.labels.length > 0) {
          const fs = cssPx('--fs-micro', 10) * pr;
          ctx.font = `500 ${fs}px ${cssVar('--font-mono')}`;
          ctx.fillStyle = cssVar('--text-faint');
          ctx.textBaseline = 'bottom';
          // Labels sit in the band under the x-axis tick labels (bottom of the canvas).
          const y = ctx.canvas.height - 1 * pr;
          ctx.textAlign = 'left';
          const starts = [xMin, ...cfg.boundaries];
          cfg.labels.forEach((label, i) => {
            const s = starts[i];
            if (s === undefined || s >= xMax) return;
            const x = Math.max(left, u.valToPos(Math.max(s, xMin), 'x', true)) + 4 * pr;
            if (x > left + width - 8 * pr) return;
            // Room up to the next boundary (or the plot's edge): short segments get a shortened
            // label rather than one that runs into its neighbour.
            const next = starts[i + 1];
            const end =
              next !== undefined && next < xMax ? u.valToPos(next, 'x', true) : left + width;
            const text = fitLabel(ctx, label.toUpperCase(), end - x - 6 * pr);
            if (text) ctx.fillText(text, x, y);
          });
        }
        ctx.restore();
      },
    },
  };
}

/** `text`, or the longest prefix ending in `…` that fits in `room` px; '' when not even 3 chars fit. */
export function fitLabel(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  room: number,
): string {
  if (ctx.measureText(text).width <= room) return text;
  for (let n = text.length - 1; n >= 3; n--) {
    const t = `${text.slice(0, n).trimEnd()}…`;
    if (ctx.measureText(t).width <= room) return t;
  }
  return '';
}
