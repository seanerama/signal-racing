/**
 * Top-down track view (design-system "Track view"; Stage 10 Lap Lab treatment; a scoped Vision
 * Lead override of "no car on screen"). It shows WHERE a moment in the graphs happened: the road
 * on a faint grid, the racing line coloured by speed against the best run (or by the selected
 * strip's channel), the car glyph at the cursor's sample and the best run's ghost car at the
 * same t (or s). During playback the cursor follows the playhead, so the car drives the lap and
 * the racing line is drawn up to it. It redraws only when the cursor, the playhead or an input
 * changes; there is no idle loop.
 */
import { effect } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RunTelemetry } from '@/telemetry/types';
import { formatValue, unitLabel } from '@/units';
import { nearestIndex, resampleOnto } from './align';
import { channelMeta } from './channel-meta';
import { cursorIdx } from './cursor-store';
import { playhead } from './playback';
import {
  drawScene,
  finiteRange,
  normalize,
  PATH_RAMP_FROM,
  poseOnGeometry,
  VIRIDIS,
  type Pose,
  type Scene,
} from './track-draw';
import type { TrackViewProps } from './types';
import { cssPx, cssVar } from './uplot-theme';
import './TrackView.css';

function poseAt(rt: RunTelemetry, idx: number, geom: TrackViewProps['geometry']): Pose {
  const i = Math.max(0, Math.min(rt.n - 1, idx));
  const has = (id: string) => rt.channelIds.includes(id);
  if (has('pos_x') && has('pos_y') && has('heading')) {
    const x = rt.getClean('pos_x')[i];
    const y = rt.getClean('pos_y')[i];
    const h = rt.getClean('heading')[i];
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(h)) {
      return { x: x as number, y: y as number, heading: h as number };
    }
  }
  return poseOnGeometry(geom, rt.s[i] ?? 0);
}

/** The best run's sample aligned to the current run's sample `idx` (same t, or same s). */
export function alignedBestIndex(
  current: RunTelemetry,
  best: RunTelemetry,
  idx: number,
  axis: 'time' | 'distance',
): number {
  const i = Math.max(0, Math.min(current.n - 1, idx));
  return axis === 'time'
    ? nearestIndex(best.t, current.t[i] as number)
    : nearestIndex(best.s, current.s[i] as number);
}

/** A run's speed (m/s) per sample: the clean `speed` channel when logged, else ds/dt. */
export function runSpeed(rt: RunTelemetry): Float64Array {
  const out = new Float64Array(rt.n);
  if (rt.channelIds.includes('speed')) {
    try {
      const v = rt.getClean('speed');
      if (v.length === rt.n) {
        for (let i = 0; i < rt.n; i++) out[i] = v[i] as number;
        return out;
      }
    } catch {
      /* fall through */
    }
  }
  for (let i = 0; i < rt.n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(rt.n - 1, i + 1);
    const dt = (rt.t[b] as number) - (rt.t[a] as number);
    out[i] = dt > 0 ? ((rt.s[b] as number) - (rt.s[a] as number)) / dt : 0;
  }
  return out;
}

/** current − best speed (m/s) at every geometry metre (NaN where either run has no data). */
export function speedDeltaPerMetre(
  current: RunTelemetry,
  best: RunTelemetry,
  count: number,
): Float64Array {
  const dst = new Float64Array(count);
  for (let i = 0; i < count; i++) dst[i] = i;
  const c = resampleOnto(current.s, runSpeed(current), dst);
  const b = resampleOnto(best.s, runSpeed(best), dst);
  const out = new Float64Array(count);
  const cEnd = current.s[current.n - 1] ?? 0;
  const bEnd = best.s[best.n - 1] ?? 0;
  for (let i = 0; i < count; i++) {
    out[i] = i > cEnd || i > bEnd ? NaN : (c[i] as number) - (b[i] as number);
  }
  return out;
}

export function TrackView({
  geometry,
  current,
  best,
  colorBy = null,
  segmentLabels,
  units,
  axis,
}: TrackViewProps) {
  const wrapRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 300, h: 248 });

  // Track the container size (CSS px); DPR scaling happens at draw time.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = geometry.points.length / 2;

  // Colour-by values per geometry metre, and the legend range (display units).
  const colouring = useMemo(() => {
    if (!colorBy || !current || !current.channelIds.includes(colorBy)) return null;
    const ys = current.get(colorBy);
    const dst = new Float64Array(count);
    for (let i = 0; i < count; i++) dst[i] = i;
    const values = resampleOnto(current.s, ys, dst);
    const range = finiteRange(values);
    if (!range) return null;
    const norm = new Float64Array(count);
    for (let i = 0; i < count; i++) norm[i] = normalize(values[i] as number, range.min, range.max);
    return { id: colorBy, norm, ...range };
  }, [colorBy, current, geometry]);

  // Racing line by speed against the best run, per metre.
  const lineDelta = useMemo(
    () => (current && best ? speedDeltaPerMetre(current, best, count) : null),
    [current, best, geometry],
  );

  // Redraw on cursor/playhead change (and when inputs change). One frame per change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const mono = cssVar('--font-mono');
    const colors: Scene['colors'] = {
      grid: cssVar('--track-grid'),
      verge: cssVar('--track-verge'),
      asphalt: cssVar('--track-asphalt'),
      line: cssVar('--track-line'),
      start: cssVar('--track-start'),
      label: cssVar('--trace-best'),
      faint: cssVar('--text-faint'),
      text: cssVar('--text'),
      bg: cssVar('--bg'),
      car: cssVar('--trace-current'),
      ghost: cssVar('--ghost-car'),
      cockpit: cssVar('--car-cockpit'),
      faster: cssVar('--gain'),
      slower: cssVar('--loss'),
      font: `400 ${cssPx('--fs-micro', 10)}px ${mono}`,
      smallFont: `400 9px ${mono}`,
      ramp: VIRIDIS.slice(PATH_RAMP_FROM).map(
        (hex, k) => cssVar(`--seq-${k + PATH_RAMP_FROM}`) || hex,
      ),
    };
    return effect(() => {
      const idx = cursorIdx.value ?? 0; // no cursor: parked at the start
      const head = playhead.value;
      const scene: Scene = {
        width: size.w,
        height: size.h,
        dpr,
        geometry,
        colors,
        pathValues: colouring?.norm ?? null,
        lineDelta,
        showLine: !!current,
        lineUpTo: current && head !== null ? (current.s[Math.min(current.n - 1, head)] ?? 0) : null,
        segmentLabels,
        current: current ? poseAt(current, idx, geometry) : poseOnGeometry(geometry, 0),
        best:
          current && best
            ? poseAt(best, alignedBestIndex(current, best, idx, axis), geometry)
            : null,
        showCar: !!current,
      };
      drawScene(ctx, scene);
      canvas.dataset['cursorIdx'] = String(idx);
    });
  }, [size, geometry, current, best, colouring, lineDelta, segmentLabels, axis]);

  const legendQ = colouring ? channelMeta(colouring.id).quantity : null;

  return (
    <section
      class="trackview"
      ref={wrapRef}
      aria-label="Track position at the cursor"
      tabIndex={0}
      data-testid="trackview"
    >
      <canvas ref={canvasRef} class="trackview__canvas" aria-hidden="true" />
      <div class="trackview__head">
        <span class="trackview__title h2">Track</span>
        {!colouring && (
          <span class="trackview__key" data-testid="trackview-key">
            {!current ? (
              'no run yet'
            ) : best ? (
              <>
                <span class="trackview__swatch trackview__swatch--faster" aria-hidden="true" />
                faster
                <span class="trackview__swatch trackview__swatch--slower" aria-hidden="true" />
                slower
                <span class="trackview__vs">than best</span>
              </>
            ) : (
              'racing line'
            )}
          </span>
        )}
        {colouring && legendQ && (
          <span class="trackview__legend" data-testid="trackview-legend">
            <span class="trackview__legend-id">{colouring.id}</span>
            <span class="trackview__legend-val">
              {formatValue(legendQ, units, colouring.min, { withUnit: false })}
            </span>
            <span class="trackview__ramp" aria-hidden="true" />
            <span class="trackview__legend-val">
              {formatValue(legendQ, units, colouring.max, { withUnit: false })}
            </span>
            <span class="dim">{unitLabel(legendQ, units)}</span>
          </span>
        )}
      </div>
    </section>
  );
}
