/**
 * Token → uPlot mapping (design-system.md). Reads the CSS custom properties at mount via
 * `getComputedStyle`, so projector mode and theme tweaks need no chart-code change. uPlot options
 * are mount-time: on a units, projector or axis change the strips are rebuilt (keyed remount),
 * never restyled in place.
 *
 * Series layout of every strip: `[x, best, current]` (best first, so it is drawn underneath).
 * `Strip` may splice dim history series between x and best.
 */
import type uPlot from 'uplot';
import type { StripOptionsArgs } from './types';

/** Width of the y-axis tick column, identical on every strip so plot areas line up. */
export const Y_AXIS_W = 40;
/** The same in projector mode (type scale ×1.25). */
export const Y_AXIS_W_PROJECTOR = 52;
/** Height of the shared x-axis (bottom strip only). */
export const X_AXIS_H = 24;
/** Extra band under the x-axis for segment labels (bottom strip, Phase B). */
export const X_AXIS_SEG_H = 12;
/** Trace hues by slot, cycling after 8. */
export const TRACE_TOKENS = ['--t1', '--t2', '--t3', '--t4', '--t5', '--t6', '--t7', '--t8'];

/** Fallbacks (the token values) for environments without computed styles (tests, SSR). */
const FALLBACK: Record<string, string> = {
  '--bg': '#0a0c0f',
  '--grid': '#1a1f27',
  '--rule': '#3a4250',
  '--text': '#d8dde4',
  '--text-dim': '#8c95a3',
  '--text-faint': '#5b6472',
  '--cursor': '#e8ecf2b3',
  '--accent': '#ffb020',
  '--accent-dim': '#ffb0201f',
  '--trace-best': '#7a8494b3',
  '--trace-history': '#7a849440',
  '--t1': '#4cc9f0',
  '--t2': '#ffb020',
  '--t3': '#f062c0',
  '--t4': '#9be564',
  '--t5': '#a78bfa',
  '--t6': '#2dd4bf',
  '--t7': '#ff7a45',
  '--t8': '#e8ecf2',
  '--font-mono': "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
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

/** The trace hue token for a 0-based slot (strip 1 → `--t1`), cycling after 8. */
export function slotToken(slot: number): string {
  const i = ((Math.floor(slot) % 8) + 8) % 8;
  return TRACE_TOKENS[i] as string;
}

/** The trace hue colour for a 0-based slot. */
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

/** y range: the union of the plotted series (uPlot passes their min/max) plus 5% padding. */
export function paddedRange(min: number | null, max: number | null): [number, number] {
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max === min) {
    const pad = Math.abs(min) * 0.05 || 0.5;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

/** Formats a tick value with just enough decimals for the tick spacing. */
export function formatTick(v: number, step: number): string {
  const dp = step >= 1 || !(step > 0) ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  const s = v.toFixed(dp);
  return s.replace(/^-(0\.?0*)$/, '$1').replace('-', '−');
}

function axisFont(): string {
  return `500 ${cssPx('--fs-micro', 10)}px ${cssVar('--font-mono')}`;
}

/**
 * uPlot options for one strip. `slot` is 0-based (strip 1 → T1). `height` is the plot height;
 * the bottom strip adds `X_AXIS_H` for the shared x-axis. Width is a placeholder; the strip sizes
 * the chart to its container.
 */
export function buildStripOptions(args: StripOptionsArgs): uPlot.Options {
  const { slot, height, showXAxis, syncKey, projector } = args;
  const grid = cssVar('--grid');
  const rule = cssVar('--rule');
  const faint = cssVar('--text-faint');
  const dim = cssVar('--text-dim');
  const font = axisFont();
  const wCur = cssPx('--trace-w-current', projector ? 2.5 : 1.5);
  const wBest = cssPx('--trace-w-best', projector ? 1.5 : 1);

  const xAxis: uPlot.Axis = showXAxis
    ? {
        scale: 'x',
        side: 2,
        size: X_AXIS_H,
        gap: 4,
        space: 64,
        font,
        stroke: dim,
        grid: { show: true, stroke: grid, width: 1 },
        ticks: { show: true, stroke: rule, width: 1, size: 4 },
        border: { show: true, stroke: rule, width: 1 },
      }
    : {
        // Hidden labels but the same gridlines, so every strip shares the vertical grid.
        scale: 'x',
        side: 2,
        size: 0,
        space: 64,
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
    gap: 4,
    font,
    stroke: faint,
    splits: (_u, _ai, min, max) => yTicks(min, max),
    values: (_u, splits) => {
      const step = splits.length > 1 ? Math.abs((splits[1] as number) - (splits[0] as number)) : 1;
      return splits.map((v) => formatTick(v, step));
    },
    grid: { show: true, stroke: grid, width: 1 },
    ticks: { show: false },
  };

  return {
    width: 600,
    height: height + (showXAxis ? X_AXIS_H : 0),
    pxAlign: 0,
    legend: { show: false },
    padding: [6, 8, showXAxis ? 0 : 2, 0],
    scales: {
      x: { time: false, auto: true },
      y: { auto: true, range: (_u, min, max) => paddedRange(min, max) },
    },
    series: [
      {},
      {
        label: 'best',
        stroke: cssVar('--trace-best'),
        width: wBest,
        spanGaps: false,
        points: { show: false },
      },
      {
        label: 'current',
        stroke: slotColor(slot),
        width: wCur,
        spanGaps: false,
        points: { show: false },
      },
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

/** History series style (older runs, dim). */
export function historySeries(): uPlot.Series {
  return {
    label: 'history',
    stroke: cssVar('--trace-history'),
    width: cssPx('--trace-w-best', 1),
    spanGaps: false,
    points: { show: false },
  };
}
