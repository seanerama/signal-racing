/**
 * Grip circle (design-system "Grip circle", Stage 9): the friction circle of each axle at the
 * shared cursor. A data plot of the model's forces, not a car depiction.
 *
 * - Radius 1 = the axle's grip budget `grip_budget_axle`; the dot is `(F_x, F_y)/F_max` from the
 *   CLEAN channels, so the panel is labelled "model estimate" (no sensor measures these forces).
 * - A fading trail covers the last 0.5 s; the best run's dot at the same t (or s) is hollow
 *   `--trace-best`; a dot outside the circle is `--loss` with a ring.
 * - It redraws only when `cursorIdx` (or an input) changes, like the track view: no idle loop.
 *   Replay moves the cursor, so it follows Replay.
 */
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatValue } from '@/units';
import { cursorIdx } from './cursor-store';
import {
  AXLES,
  axlePoint,
  drawGripCircle,
  hasGripChannels,
  radiusOf,
  trailWindow,
  type GripPoint,
  type GripScene,
} from './grip-circle-draw';
import { alignedBestIndex } from './TrackView';
import type { GripCircleProps } from './types';
import { cssPx, cssVar } from './uplot-theme';
import './GripCircle.css';

export function GripCircle({ current, best, axis, units }: GripCircleProps) {
  const wrapRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 320, h: 96 });
  const [label, setLabel] = useState('');
  const usable = !!current && hasGripChannels(current);
  const bestUsable = !!best && hasGripChannels(best);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const colors: GripScene['colors'] = {
      ring: cssVar('--rule'),
      grid: cssVar('--grid'),
      text: cssVar('--text'),
      dim: cssVar('--text-dim'),
      best: cssVar('--trace-best'),
      loss: cssVar('--loss'),
      bg: cssVar('--bg'),
      font: `500 ${cssPx('--fs-micro', 10)}px ${cssVar('--font-mono')}`,
    };
    let draws = 0;
    return effect(() => {
      const idx = cursorIdx.value ?? 0;
      const scene: GripScene = {
        width: size.w,
        height: size.h,
        dpr,
        colors,
        axles: {
          front: { current: null, trail: [], best: null },
          rear: { current: null, trail: [], best: null },
        },
      };
      const used: string[] = [];
      if (usable && current) {
        const [from, to] = trailWindow(current.t, idx);
        const bi = bestUsable && best ? alignedBestIndex(current, best, idx, axis) : -1;
        for (const axle of AXLES) {
          const trail: GripPoint[] = [];
          for (let i = from; i < to; i++) trail.push(axlePoint(current, axle, i));
          const cur = axlePoint(current, axle, to);
          scene.axles[axle] = {
            current: cur,
            trail,
            best: bi >= 0 && best ? axlePoint(best, axle, bi) : null,
          };
          used.push(`${axle} ${formatValue('fraction', units, radiusOf(cur))}`);
        }
      }
      drawGripCircle(ctx, scene);
      canvas.dataset['cursorIdx'] = String(idx);
      canvas.dataset['draws'] = String(++draws);
      setLabel(used.join(', '));
    });
  }, [size, current, best, usable, bestUsable, axis, units]);

  return (
    <section
      class="gripcircle"
      ref={wrapRef}
      aria-label={`Grip circle, model estimate${label ? `: grip used ${label}` : ''}`}
      data-testid="grip-circle"
    >
      <canvas ref={canvasRef} class="gripcircle__canvas" aria-hidden="true" />
      <div class="gripcircle__head micro">
        <span class="gripcircle__title">GRIP</span>
        <span class="gripcircle__note">model estimate</span>
      </div>
      {!usable && <span class="gripcircle__empty micro faint">no run</span>}
    </section>
  );
}
