/**
 * Pure helpers for the grip circle (design-system "Grip circle", Stage 9): one friction circle
 * per axle, normalised so radius 1 = the axle's grip budget `F_max = Σ μ_i·N_i`, with the tire
 * force demand as a dot at `(F_x/F_max, F_y/F_max)`.
 *
 * Screen layout follows the g-g diagram convention: lateral force to the right (`F_y`, toward the
 * corner centre, so a cornering dot sits right of centre), longitudinal force up for drive and
 * down for braking. Nothing here touches the DOM; `drawGripCircle` draws one complete frame.
 */
import type { RunTelemetry } from '@/telemetry/types';

export type Axle = 'front' | 'rear';
export const AXLES: readonly Axle[] = ['front', 'rear'];

/** s, length of the fading trail behind the current dot. */
export const TRAIL_S = 0.5;
/** px, gap around each circle inside its half of the canvas. */
export const CIRCLE_PAD = 6;
/** px, top padding for the header row. */
export const CIRCLE_PAD_TOP = 14;

/** A normalised force point: x = F_x/F_max (+ drive), y = F_y/F_max (+ toward the centre). */
export interface GripPoint {
  x: number;
  y: number;
}

/** `(F_x/F_max, F_y/F_max)`; NaN when the budget is not positive or a value is missing. */
export function normalizeForce(fx: number, fy: number, fMax: number): GripPoint {
  if (!(fMax > 0) || !Number.isFinite(fx) || !Number.isFinite(fy)) return { x: NaN, y: NaN };
  return { x: fx / fMax, y: fy / fMax };
}

/** Distance from the centre (the axle's grip used). */
export function radiusOf(p: GripPoint): number {
  return Math.hypot(p.x, p.y);
}

/** Outside the circle: the demand exceeds the budget (sliding). */
export function isOutside(p: GripPoint): boolean {
  return radiusOf(p) > 1;
}

/**
 * Sample range of the trail ending at `idx`: every sample with `t ≥ t[idx] − windowS`, as
 * `[start, idx]` inclusive. `t` is ascending.
 */
export function trailWindow(
  t: ArrayLike<number>,
  idx: number,
  windowS: number = TRAIL_S,
): [number, number] {
  const n = t.length;
  if (n === 0) return [0, -1];
  const end = Math.max(0, Math.min(n - 1, idx));
  const from = (t[end] as number) - windowS;
  let start = end;
  while (start > 0 && (t[start - 1] as number) >= from - 1e-9) start--;
  return [start, end];
}

/** The clean (model) force point of one axle at sample `i`. */
export function axlePoint(rt: RunTelemetry, axle: Axle, i: number): GripPoint {
  const j = Math.max(0, Math.min(rt.n - 1, i));
  return normalizeForce(
    rt.getClean(`fx_${axle}`)[j] as number,
    rt.getClean(`fy_${axle}`)[j] as number,
    rt.getClean(`grip_budget_${axle}`)[j] as number,
  );
}

/** Does this run carry what the grip circle needs? */
export function hasGripChannels(rt: RunTelemetry): boolean {
  return AXLES.every((a) =>
    [`fx_${a}`, `fy_${a}`, `grip_budget_${a}`].every((id) => rt.channelIds.includes(id)),
  );
}

/** Centre and radius (px) of each axle's circle: the canvas split in two halves. */
export function circleLayout(
  width: number,
  height: number,
): Record<Axle, { cx: number; cy: number; r: number }> {
  const half = width / 2;
  const avail = Math.max(4, height - CIRCLE_PAD_TOP - CIRCLE_PAD);
  const r = Math.max(4, Math.min(half - 2 * CIRCLE_PAD - 28, avail) / 2);
  const cy = CIRCLE_PAD_TOP + avail / 2;
  return {
    front: { cx: half / 2 + 14, cy, r },
    rear: { cx: half + half / 2 + 14, cy, r },
  };
}

/** Canvas px of a normalised point on a circle: lateral → right, longitudinal → up. */
export function toCirclePx(
  c: { cx: number; cy: number; r: number },
  p: GripPoint,
): [number, number] {
  return [c.cx + p.y * c.r, c.cy - p.x * c.r];
}

export interface GripScene {
  width: number;
  height: number;
  dpr: number;
  colors: {
    ring: string;
    grid: string;
    text: string;
    dim: string;
    best: string;
    loss: string;
    bg: string;
    font: string;
  };
  /** Per axle: the current dot, its trail (oldest first) and the best run's dot. */
  axles: Record<Axle, { current: GripPoint | null; trail: GripPoint[]; best: GripPoint | null }>;
}

const LABEL: Record<Axle, string> = { front: 'FRONT', rear: 'REAR' };

function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string | null,
  stroke: string | null,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Draws one complete frame. */
export function drawGripCircle(ctx: CanvasRenderingContext2D, s: GripScene): void {
  const { colors } = s;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, s.width, s.height);
  const layout = circleLayout(s.width, s.height);
  ctx.font = colors.font;
  ctx.textBaseline = 'middle';
  for (const axle of AXLES) {
    const c = layout[axle];
    const a = s.axles[axle];
    // Budget circle and crosshair.
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(c.cx - c.r, c.cy);
    ctx.lineTo(c.cx + c.r, c.cy);
    ctx.moveTo(c.cx, c.cy - c.r);
    ctx.lineTo(c.cx, c.cy + c.r);
    ctx.stroke();
    dot(ctx, c.cx, c.cy, c.r, null, colors.ring);
    // Label, left of the circle.
    ctx.fillStyle = colors.dim;
    ctx.textAlign = 'right';
    ctx.fillText(LABEL[axle], c.cx - c.r - 6, c.cy - 6);
    // Trail: oldest faint, newest stronger.
    const n = a.trail.length;
    a.trail.forEach((p, k) => {
      if (!Number.isFinite(p.x)) return;
      const [x, y] = toCirclePx(c, p);
      ctx.globalAlpha = 0.08 + 0.5 * ((k + 1) / Math.max(1, n));
      dot(ctx, x, y, 1.5, isOutside(p) ? colors.loss : colors.text, null);
    });
    ctx.globalAlpha = 1;
    // Best run at the same instant: hollow.
    if (a.best && Number.isFinite(a.best.x)) {
      const [x, y] = toCirclePx(c, a.best);
      ctx.lineWidth = 1;
      dot(ctx, x, y, 3.5, null, colors.best);
    }
    // Current run: solid; outside the circle in --loss with a ring.
    if (a.current && Number.isFinite(a.current.x)) {
      const [x, y] = toCirclePx(c, a.current);
      const out = isOutside(a.current);
      dot(ctx, x, y, 3, out ? colors.loss : colors.text, colors.bg);
      if (out) {
        ctx.lineWidth = 1;
        dot(ctx, x, y, 6, null, colors.loss);
      }
      // Grip used, right of the label.
      ctx.fillStyle = out ? colors.loss : colors.text;
      ctx.fillText(radiusOf(a.current).toFixed(2), c.cx - c.r - 6, c.cy + 7);
    }
  }
}
