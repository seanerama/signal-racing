/**
 * Pure helpers for the grip circle (design-system "Grip circle", Stage 9; restyled in Stage 10 in
 * the Lap Lab friction-circle treatment): one friction circle per axle, normalised so radius 1 =
 * the axle's grip budget `F_max = Σ μ_i·N_i`, with the tire force demand drawn as a lime
 * **vector** from the centre to a dot at `(F_x/F_max, F_y/F_max)`. A thin outline, crossed axes
 * reaching a little past the circle, and axis labels `ACCEL` (up), `BRAKE` (down), `TURN →`.
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
/** px, top padding: the header row and the ACCEL label. */
export const CIRCLE_PAD_TOP = 58;
/** px, bottom padding: the BRAKE label and the axle name line. */
export const CIRCLE_PAD_BOTTOM = 30;
/** px reserved right of each circle for the `TURN →` label. */
export const TURN_LABEL_W = 46;
/** px the crossed axes reach past the circle. */
export const AXIS_OVERHANG = 7;

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

/**
 * Car-level readout at sample `i`: lateral and longitudinal g (clean `lat_g` / `long_g` when the
 * level logs them, else NaN) and the share of the total grip budget in use,
 * `|ΣF| / ΣF_max` over both axles.
 */
export function carReadout(
  rt: RunTelemetry,
  i: number,
): { latG: number; longG: number; used: number } {
  const j = Math.max(0, Math.min(rt.n - 1, i));
  const clean = (id: string): number => {
    if (!rt.channelIds.includes(id)) return NaN;
    try {
      return rt.getClean(id)[j] as number;
    } catch {
      return NaN;
    }
  };
  let fx = 0;
  let fy = 0;
  let budget = 0;
  for (const a of AXLES) {
    fx += rt.getClean(`fx_${a}`)[j] as number;
    fy += rt.getClean(`fy_${a}`)[j] as number;
    budget += rt.getClean(`grip_budget_${a}`)[j] as number;
  }
  return {
    latG: clean('lat_g'),
    longG: clean('long_g'),
    used: budget > 0 ? Math.hypot(fx, fy) / budget : NaN,
  };
}

/**
 * Does this run carry what the grip circle needs? The force channels must be on the level; the
 * budget is read from the run's clean model columns whether or not the level lists
 * `grip_budget_*` as a channel (the circle is a model plot, not a sensor view).
 */
export function hasGripChannels(rt: RunTelemetry): boolean {
  return AXLES.every((a) => {
    if (![`fx_${a}`, `fy_${a}`].every((id) => rt.channelIds.includes(id))) return false;
    try {
      return rt.getClean(`grip_budget_${a}`).length === rt.n;
    } catch {
      return false;
    }
  });
}

/** Centre and radius (px) of each axle's circle: the canvas split in two halves. */
export function circleLayout(
  width: number,
  height: number,
): Record<Axle, { cx: number; cy: number; r: number }> {
  const half = width / 2;
  const avail = Math.max(8, height - CIRCLE_PAD_TOP - CIRCLE_PAD_BOTTOM);
  // Leave room on the right of each circle for the `TURN →` label.
  const r = Math.max(4, Math.min(half - 2 * CIRCLE_PAD - TURN_LABEL_W - AXIS_OVERHANG, avail) / 2);
  const cy = CIRCLE_PAD_TOP + avail / 2;
  // Centre the circle plus its TURN label inside each half.
  const block = 2 * r + AXIS_OVERHANG + TURN_LABEL_W;
  const left = Math.max(CIRCLE_PAD, (half - block) / 2);
  return {
    front: { cx: left + r, cy, r },
    rear: { cx: half + left + r, cy, r },
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
    /** Stage 10: the demand vector and dot (lime). Falls back to `text`. */
    vector?: string;
    /** Stage 10: axis-label font (small mono). Falls back to `font`. */
    labelFont?: string;
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
  const vector = colors.vector ?? colors.text;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, s.width, s.height);
  const layout = circleLayout(s.width, s.height);
  ctx.textBaseline = 'middle';
  for (const axle of AXLES) {
    const c = layout[axle];
    const a = s.axles[axle];
    // Crossed axes, reaching past the circle, then the thin budget outline.
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(c.cx - c.r - AXIS_OVERHANG, c.cy);
    ctx.lineTo(c.cx + c.r + AXIS_OVERHANG, c.cy);
    ctx.moveTo(c.cx, c.cy - c.r - AXIS_OVERHANG);
    ctx.lineTo(c.cx, c.cy + c.r + AXIS_OVERHANG);
    ctx.stroke();
    dot(ctx, c.cx, c.cy, c.r, null, colors.ring);
    // Axis labels (small mono, muted) and the axle name.
    ctx.font = colors.labelFont ?? colors.font;
    ctx.fillStyle = colors.dim;
    ctx.textAlign = 'center';
    ctx.fillText('ACCEL', c.cx, c.cy - c.r - AXIS_OVERHANG - 6);
    ctx.fillText('BRAKE', c.cx, c.cy + c.r + AXIS_OVERHANG + 6);
    ctx.textAlign = 'left';
    ctx.fillText('TURN →', c.cx + c.r + AXIS_OVERHANG + 3, c.cy);
    // Axle name at the bottom of its half; the grip used follows it once there is a run.
    ctx.font = colors.font;
    ctx.fillStyle = colors.dim;
    ctx.textAlign = 'left';
    const nameX = c.cx - c.r - AXIS_OVERHANG;
    const nameY = s.height - 8;
    ctx.fillText(LABEL[axle], nameX, nameY);
    const nameW = ctx.measureText(`${LABEL[axle]} `).width;
    // Trail: oldest faint, newest stronger.
    const n = a.trail.length;
    a.trail.forEach((p, k) => {
      if (!Number.isFinite(p.x)) return;
      const [x, y] = toCirclePx(c, p);
      ctx.globalAlpha = 0.06 + 0.4 * ((k + 1) / Math.max(1, n));
      dot(ctx, x, y, 1.5, isOutside(p) ? colors.loss : vector, null);
    });
    ctx.globalAlpha = 1;
    // Best run at the same instant: hollow grey.
    if (a.best && Number.isFinite(a.best.x)) {
      const [x, y] = toCirclePx(c, a.best);
      ctx.lineWidth = 1;
      dot(ctx, x, y, 3.5, null, colors.best);
    }
    // Current run: a 2 px vector from the centre to a dot; outside the circle in --loss + ring.
    if (a.current && Number.isFinite(a.current.x)) {
      const [x, y] = toCirclePx(c, a.current);
      const out = isOutside(a.current);
      const col = out ? colors.loss : vector;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(c.cx, c.cy);
      ctx.lineTo(x, y);
      ctx.stroke();
      dot(ctx, x, y, 4, col, null);
      if (out) {
        ctx.lineWidth = 1;
        dot(ctx, x, y, 7, null, colors.loss);
      }
      // Grip used, after the axle name: `FRONT 87 %`.
      ctx.font = colors.font;
      ctx.fillStyle = out ? colors.loss : colors.text;
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(radiusOf(a.current) * 100)} %`, nameX + nameW, nameY);
    }
  }
}
