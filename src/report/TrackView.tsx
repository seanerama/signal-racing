/**
 * Top-down track view (design-system "Track view"; a scoped Vision Lead override of "no car on
 * screen"). It shows WHERE a moment in the graphs happened, nothing else: the path, a plain block
 * at the cursor's sample, a hollow best-run block at the same t (or s), optional colour-by-channel
 * and a player-started Replay. It redraws only when the cursor or its inputs change; there is no
 * idle animation loop.
 */
import { effect } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RunTelemetry } from '@/telemetry/types';
import { formatValue, unitLabel } from '@/units';
import { Button } from '@/app/components/Button';
import { nearestIndex, resampleOnto } from './align';
import { channelMeta } from './channel-meta';
import { cursorIdx, replaying, stopReplay, toggleReplay } from './cursor-store';
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

export function TrackView({
  geometry,
  current,
  best,
  colorBy = null,
  segmentLabels,
  units,
  axis,
}: TrackViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 320, h: 200 });

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

  // Colour-by values per geometry metre, and the legend range (display units).
  const colouring = useMemo(() => {
    if (!colorBy || !current || !current.channelIds.includes(colorBy)) return null;
    const ys = current.get(colorBy);
    const count = geometry.points.length / 2;
    const dst = new Float64Array(count);
    for (let i = 0; i < count; i++) dst[i] = i;
    const values = resampleOnto(current.s, ys, dst);
    const range = finiteRange(values);
    if (!range) return null;
    const norm = new Float64Array(count);
    for (let i = 0; i < count; i++) norm[i] = normalize(values[i] as number, range.min, range.max);
    return { id: colorBy, norm, ...range };
  }, [colorBy, current, geometry]);

  // Redraw on cursor change (and when inputs change). One frame per change, nothing idle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const colors = {
      rule: cssVar('--rule'),
      faint: cssVar('--text-faint'),
      text: cssVar('--text'),
      bg: cssVar('--bg'),
      best: cssVar('--trace-best'),
      font: `500 ${cssPx('--fs-micro', 10)}px ${cssVar('--font-mono')}`,
      ramp: VIRIDIS.slice(PATH_RAMP_FROM).map(
        (hex, k) => cssVar(`--seq-${k + PATH_RAMP_FROM}`) || hex,
      ),
    };
    return effect(() => {
      const idx = cursorIdx.value ?? 0; // no cursor: parked at the start
      const scene: Scene = {
        width: size.w,
        height: size.h,
        dpr,
        geometry,
        colors,
        pathValues: colouring?.norm ?? null,
        segmentLabels,
        current: current ? poseAt(current, idx, geometry) : poseOnGeometry(geometry, 0),
        best:
          current && best
            ? poseAt(best, alignedBestIndex(current, best, idx, axis), geometry)
            : null,
      };
      drawScene(ctx, scene);
      canvas.dataset['cursorIdx'] = String(idx);
    });
  }, [size, geometry, current, best, colouring, segmentLabels, axis]);

  // Space toggles Replay while focus is in the view (or nowhere in particular).
  const canReplay = !!current && current.n > 1;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== ' ' || !current || !canReplay) return;
      const target = ev.target as HTMLElement | null;
      const inView = !!target && !!wrapRef.current?.contains(target);
      const idle = !target || target === document.body;
      if (!inView && !idle) return;
      if (target && /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      ev.preventDefault();
      toggleReplay(current.n, current.dt, ev.shiftKey ? 4 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, canReplay]);

  // Stop a sweep when the run under it goes away.
  useEffect(() => () => stopReplay(), [current]);

  const isReplaying = replaying.value;
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
        <span class="trackview__title micro">TRACK</span>
        {colouring && legendQ && (
          <span class="trackview__legend micro" data-testid="trackview-legend">
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
        <Button
          variant="ghost"
          size="compact"
          class="trackview__replay"
          disabled={!canReplay}
          aria-pressed={isReplaying}
          title="Replay at 1× (Shift+click for 4×). Space toggles, Esc stops."
          onClick={(ev: MouseEvent) => {
            if (!current) return;
            toggleReplay(current.n, current.dt, ev.shiftKey ? 4 : 1);
          }}
        >
          {isReplaying ? '■ Stop' : '▶ Replay'}
        </Button>
      </div>
    </section>
  );
}
