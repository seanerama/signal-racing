/**
 * Token → uPlot mapping (design-system.md; Stage 10 style guide "Trace hierarchy"). Reads the
 * CSS custom properties at mount via `getComputedStyle`, so projector mode, density and theme
 * tweaks need no chart-code change. uPlot options are mount-time: on a units, projector or axis
 * change the strips are rebuilt (keyed remount), never restyled in place.
 *
 * Trace hierarchy (style guide): the current run is lime `--trace-current`, 1.5 px solid, in
 * every strip; the reference (best) run is `--trace-best` `#7b9092`, 1 px dashed `[5, 5]`, so the
 * two stay identifiable without colour. There is no per-strip hue: a strip's identity comes from
 * its persistent label. Grids are quiet `--grid` lines.
 *
 * Series layout of every strip: `[x, ...history, best, current]` (best first, so it is drawn
 * underneath). The current series' path can be cut at the playhead (real-time playback).
 */
import uPlot from 'uplot';
import type { StripOptionsArgs } from './types';

/** Width of the y-axis tick column, identical on every strip so plot areas line up. */
export const Y_AXIS_W = 44;
/** The same in projector mode (type scale ×1.25). */
export const Y_AXIS_W_PROJECTOR = 56;
/** Height of the shared x-axis (bottom strip only). */
export const X_AXIS_H = 26;
/** Extra band under the x-axis for segment labels (bottom strip, Phase B). */
export const X_AXIS_SEG_H = 14;
/** Reference dash (style guide: `[5, 5]`). */
export const BEST_DASH: number[] = [5, 5];

/** Fallbacks (the token values) for environments without computed styles (tests, SSR). */
const FALLBACK: Record<string, string> = {
  '--bg': '#101516',
  '--panel': '#192022',
  '--line': '#303b3c',
  '--grid': '#2a3638',
  '--rule': '#435253',
  '--text': '#edf2eb',
  '--text-dim': '#9aa8a8',
  '--text-faint': '#788686',
  '--cursor': '#ffffff55',
  '--accent': '#c9f36a',
  '--accent-dim': '#c9f36a0b',
  '--trace-current': '#c9f36a',
  '--trace-best': '#7b9092',
  '--trace-support': '#dfe8e3',
  '--trace-history': '#7b909240',
  '--blue': '#77c7df',
  '--ghost-car': '#718489',
  '--track-grid': '#233032',
  '--track-verge': '#344244',
  '--track-asphalt': '#0f1618',
  '--track-line': '#50747b',
  '--track-start': '#dfe8e3',
  '--car-cockpit': '#0e1617',
  '--best': '#c9f36a',
  '--gain': '#c9f36a',
  '--loss': '#ffac71',
  '--font-mono': "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  '--font-sans': "'DM Sans', system-ui, sans-serif",
  '--fs-micro': '10px',
};

/** Reads one CSS custom property from the root, falling back to the design-token value. */
export function cssVar(name: string): string {
  let v = '';
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
  } catch {
    v = '';
  }
  return v || FALLBACK[name] || '';
}

/** Parses a `px` token, e.g. `'1.5px'` → 1.5. */
export function cssPx(name: string, fallback: number): number {
  const n = parseFloat(cssVar(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The current-run trace token. Stage 10 removed the 8-hue slot palette: every strip draws the
 * current run in lime. Kept as a function of the slot so callers (table swatch, waterfall) need
 * no change when a multi-quantity plot later assigns stable series colours.
 */
export function slotToken(_slot: number): string {
  return '--trace-current';
}

/** The current-run trace colour (lime). */
export function slotColor(slot: number): string {
  return cssVar(slotToken(slot));
}

/** "Nice" step for a range spanning `span` with about `count` intervals. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !(count > 0)) return 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/** At most 3 nice y ticks inside `[min, max]` (design-system "Strip": 3 ticks max). */
export function yTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [min];
  let step = niceStep(max - min, 3);
  let ticks: number[] = [];
  for (let guard = 0; guard < 6; guard++) {
    ticks = [];
    const start = Math.ceil(min / step - 1e-9) * step;
    for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
    if (ticks.length <= 3) break;
    step = niceStep(step * 1.0001, 1); // next nice step up
  }
  return ticks.slice(0, 3);
}

/**
 * y range: the union of the plotted series (uPlot passes their min/max) plus 5 % padding, and
 * never narrower than `minSpan` (display units; Stage 10): a flat channel is centred in a span
 * wide enough that its noise reads as noise, not as signal.
 */
export function paddedRange(
  min: number | null,
  max: number | null,
  minSpan = 0,
  bounds?: [number, number],
): [number, number] {
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  let lo = min;
  let hi = max;
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
    // Keep a non-negative quantity's floor at 0 when the data allow it.
    if (min >= 0 && lo < 0) {
      hi -= lo;
      lo = 0;
    }
    // Never widen past a physical bound (e.g. 100 % throttle): shift the window inside it.
    if (bounds && hi > bounds[1] && max <= bounds[1]) {
      lo -= hi - bounds[1];
      hi = bounds[1];
    }
    if (bounds && lo < bounds[0] && min >= bounds[0]) {
      hi += bounds[0] - lo;
      lo = bounds[0];
    }
  }
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.05 || 0.5;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

/** Formats a tick value with just enough decimals for the tick spacing. */
export function formatTick(v: number, step: number): string {
  const dp = step >= 1 || !(step > 0) ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  const s = v.toFixed(dp);
  return s.replace(/^-(0\.?0*)$/, '$1').replace('-', '−');
}

function axisFont(): string {
  return `400 ${cssPx('--fs-micro', 10)}px ${cssVar('--font-mono')}`;
}

/**
 * A linear path builder whose drawing stops at `limit()` (a sample index; `Infinity` = draw it
 * all). Used for the current run during playback: the strip grows left to right while the
 * reference stays complete. Slicing the index range, not copying data, keeps a frame cheap.
 */
export function progressivePaths(limit: () => number): uPlot.Series.PathBuilder {
  const linear = uPlot.paths?.linear?.();
  return (u, seriesIdx, idx0, idx1) => {
    const lim = limit();
    const end = Number.isFinite(lim) ? Math.max(idx0, Math.min(idx1, Math.floor(lim))) : idx1;
    return linear ? linear(u, seriesIdx, idx0, end) : null;
  };
}

/**
 * uPlot options for one strip. `height` is the plot height; the bottom strip adds `X_AXIS_H` for
 * the shared x-axis. Width is a placeholder; the strip sizes the chart to its container.
 * `minSpan` (display units) floors the y range; `limit` cuts the current trace at the playhead.
 */
export function buildStripOptions(
  args: StripOptionsArgs & {
    minSpan?: number;
    limit?: () => number;
    xUnit?: string;
    bounds?: [number, number];
  },
): uPlot.Options {
  const { height, showXAxis, syncKey, projector } = args;
  const grid = cssVar('--grid');
  const rule = cssVar('--rule');
  const dim = cssVar('--text-dim');
  const font = axisFont();
  const wCur = cssPx('--trace-w-current', projector ? 2.5 : 1.5);
  const wBest = cssPx('--trace-w-best', projector ? 1.5 : 1);
  const minSpan = args.minSpan ?? 0;

  const xAxis: uPlot.Axis = showXAxis
    ? {
        scale: 'x',
        side: 2,
        size: X_AXIS_H,
        gap: 6,
        space: 72,
        font,
        stroke: dim,
        // The unit rides on the last tick, like the specimen's "0 m … 1,000 m".
        values: (_u, splits) => {
          const step =
            splits.length > 1 ? Math.abs((splits[1] as number) - (splits[0] as number)) : 1;
          return splits.map((v, i) => {
            const txt = formatTick(v, step);
            return args.xUnit && i === splits.length - 1 ? `${txt} ${args.xUnit}` : txt;
          });
        },
        grid: { show: true, stroke: grid, width: 1 },
        ticks: { show: true, stroke: grid, width: 1, size: 4 },
        border: { show: true, stroke: rule, width: 1 },
      }
    : {
        // Hidden labels but the same gridlines, so every strip shares the vertical grid.
        scale: 'x',
        side: 2,
        size: 0,
        space: 72,
        font,
        stroke: dim,
        values: (_u, splits) => splits.map(() => ''),
        grid: { show: true, stroke: grid, width: 1 },
        ticks: { show: false },
      };

  const yAxis: uPlot.Axis = {
    scale: 'y',
    side: 3,
    size: projector ? Y_AXIS_W_PROJECTOR : Y_AXIS_W,
    gap: 6,
    font,
    stroke: dim,
    splits: (_u, _ai, min, max) => yTicks(min, max),
    values: (_u, splits) => {
      const step = splits.length > 1 ? Math.abs((splits[1] as number) - (splits[0] as number)) : 1;
      return splits.map((v) => formatTick(v, step));
    },
    grid: { show: true, stroke: grid, width: 1 },
    ticks: { show: false },
  };

  const current: uPlot.Series = {
    label: 'current',
    stroke: cssVar('--trace-current'),
    width: wCur,
    spanGaps: false,
    points: { show: false },
  };
  if (args.limit) current.paths = progressivePaths(args.limit);

  return {
    width: 600,
    height: height + (showXAxis ? X_AXIS_H : 0),
    pxAlign: 0,
    legend: { show: false },
    padding: [8, 10, showXAxis ? 0 : 4, 0],
    scales: {
      x: { time: false, auto: true },
      y: { auto: true, range: (_u, min, max) => paddedRange(min, max, minSpan, args.bounds) },
    },
    series: [
      {},
      {
        label: 'best',
        stroke: cssVar('--trace-best'),
        width: wBest,
        dash: BEST_DASH,
        spanGaps: false,
        points: { show: false },
      },
      current,
    ],
    axes: [xAxis, yAxis],
    cursor: {
      x: true,
      y: false,
      points: { show: false },
      focus: { prox: -1 },
      // Zoom is Shift+drag only (see cursor.ts). uPlot swallows the click after anything it
      // thinks was a drag; plain presses never reach its mousedown, so let clicks through
      // (they pin the cursor; Shift+clicks are ignored by the pin handler).
      drag: { x: true, y: false, setScale: false, click: () => undefined },
      sync: { key: syncKey, setSeries: false },
    },
    select: { show: true, left: 0, top: 0, width: 0, height: 0 },
  };
}

/** History series style (older runs: thin, solid, 25 % of the reference grey). */
export function historySeries(): uPlot.Series {
  return {
    label: 'history',
    stroke: cssVar('--trace-history'),
    width: cssPx('--trace-w-best', 1),
    spanGaps: false,
    points: { show: false },
  };
}
