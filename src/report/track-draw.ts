/**
 * Pure drawing helpers for the top-down track view (design-system "Track view").
 *
 * World coordinates are metres, north-up, heading in degrees CCW from east (contract 01/02).
 * Canvas coordinates are CSS pixels with y pointing down, so the transform flips y. Nothing here
 * touches the DOM: `drawScene` takes a 2D context and draws one complete frame.
 */
import type { TrackGeometry } from '@/engine/types';

export const TRACK_PAD = 12;
/** Top padding: room for the view's header row (title, legend, Replay) above the path. */
export const TRACK_PAD_TOP = 26;
/** Car block, scaled from 5.0 × 2.0 m, never smaller than 10 × 4 px. */
export const BLOCK_LEN_M = 5;
export const BLOCK_WID_M = 2;
export const BLOCK_MIN_LEN_PX = 10;
export const BLOCK_MIN_WID_PX = 4;
const TICK_PX = 6;

/**
 * Default viridis stops (the `--seq-0…8` token values). The track path uses the upper part of the
 * ramp (`PATH_RAMP_FROM`) because the darkest stops vanish against `--bg`.
 */
export const VIRIDIS = [
  '#440154',
  '#472d7b',
  '#3b528b',
  '#2c728e',
  '#21918c',
  '#28ae80',
  '#5ec962',
  '#addc30',
  '#fde725',
];

/** First `--seq-*` stop used for the track path (the darker stops are invisible on `--bg`). */
export const PATH_RAMP_FROM = 2;

export interface Pose {
  x: number;
  y: number;
  /** Degrees, CCW from east. */
  heading: number;
}

/** canvasX = tx + x·scale; canvasY = ty − y·scale (north-up, uniform scale, centred). */
export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

/** Fits `bounds` into a `width × height` canvas with `pad` px on each side (`padTop` on top), centred. */
export function fitTransform(
  bounds: TrackGeometry['bounds'],
  width: number,
  height: number,
  pad = TRACK_PAD,
  padTop = pad,
): Transform {
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
  const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const aw = Math.max(1, width - 2 * pad);
  const ah = Math.max(1, height - pad - padTop);
  const scale = Math.min(aw / bw, ah / bh);
  const offX = pad + (aw - bw * scale) / 2;
  const offY = padTop + (ah - bh * scale) / 2;
  return {
    scale,
    tx: offX - bounds.minX * scale,
    // y flips: maxY maps to offY.
    ty: offY + bounds.maxY * scale,
  };
}

export function toCanvas(tf: Transform, x: number, y: number): [number, number] {
  return [tf.tx + x * tf.scale, tf.ty - y * tf.scale];
}

/**
 * The car block's four corners in canvas px, in order: front-left, front-right, rear-right,
 * rear-left (relative to the direction of travel).
 */
export function blockCorners(tf: Transform, pose: Pose): Array<[number, number]> {
  const len = Math.max(BLOCK_MIN_LEN_PX, BLOCK_LEN_M * tf.scale) / 2;
  const wid = Math.max(BLOCK_MIN_WID_PX, BLOCK_WID_M * tf.scale) / 2;
  const th = (pose.heading * Math.PI) / 180;
  // Direction of travel in canvas space (y down).
  const fx = Math.cos(th);
  const fy = -Math.sin(th);
  // Left of travel in canvas space.
  const lx = fy;
  const ly = -fx;
  const [cx, cy] = toCanvas(tf, pose.x, pose.y);
  return [
    [cx + fx * len + lx * wid, cy + fy * len + ly * wid],
    [cx + fx * len - lx * wid, cy + fy * len - ly * wid],
    [cx - fx * len - lx * wid, cy - fy * len - ly * wid],
    [cx - fx * len + lx * wid, cy - fy * len + ly * wid],
  ];
}

/** Pose at distance `d` along the geometry (points every 1 m), interpolated. */
export function poseOnGeometry(geom: TrackGeometry, d: number): Pose {
  const pts = geom.points;
  const count = pts.length / 2;
  if (count === 0) return { x: 0, y: 0, heading: 0 };
  if (count === 1) return { x: pts[0] as number, y: pts[1] as number, heading: 0 };
  const clamped = Math.max(0, Math.min(count - 1, d));
  const i = Math.min(count - 2, Math.floor(clamped));
  const f = clamped - i;
  const x0 = pts[i * 2] as number;
  const y0 = pts[i * 2 + 1] as number;
  const x1 = pts[i * 2 + 2] as number;
  const y1 = pts[i * 2 + 3] as number;
  return {
    x: x0 + (x1 - x0) * f,
    y: y0 + (y1 - y0) * f,
    heading: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').slice(0, 6);
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour at `t ∈ [0, 1]` on the ramp (linear between stops). Clamped. */
export function rampColor(t: number, ramp: readonly string[] = VIRIDIS): string {
  const tt = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const pos = tt * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(ramp[i] as string);
  const b = hexToRgb(ramp[i + 1] as string);
  const c = a.map((v, k) => Math.round(v + ((b[k] as number) - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** WCAG relative luminance of an `rgb(r, g, b)` or hex colour (tests: the ramp is monotonic). */
export function luminance(color: string): number {
  const m = color.match(/\d+/g);
  const rgb: number[] = color.startsWith('#') ? hexToRgb(color) : (m ?? []).slice(0, 3).map(Number);
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}

/** Min/max of finite values; null if none. */
export function finiteRange(values: ArrayLike<number>): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

/** Normalises to `[0, 1]` (NaN stays NaN; a flat range maps to 0.5). */
export function normalize(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return NaN;
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

export interface SceneColors {
  rule: string;
  faint: string;
  text: string;
  bg: string;
  best: string;
  font: string;
  ramp: readonly string[];
}

export interface Scene {
  /** CSS px. */
  width: number;
  height: number;
  dpr: number;
  geometry: TrackGeometry;
  colors: SceneColors;
  /** Per geometry point, normalised 0–1 (NaN = no data); null = plain path. */
  pathValues: ArrayLike<number> | null;
  segmentLabels: string[];
  current: Pose;
  best: Pose | null;
}

/** Draws one complete frame. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { width, height, dpr, geometry, colors } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const tf = fitTransform(geometry.bounds, width, height, TRACK_PAD, TRACK_PAD_TOP);
  const pts = geometry.points;
  const count = pts.length / 2;

  // Path: 2px --rule, or coloured per metre by the selected channel.
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!scene.pathValues) {
    ctx.strokeStyle = colors.rule;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const [x, y] = toCanvas(tf, pts[i * 2] as number, pts[i * 2 + 1] as number);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    for (let i = 0; i < count - 1; i++) {
      const v = scene.pathValues[i] as number;
      ctx.strokeStyle = Number.isFinite(v) ? rampColor(v, colors.ramp) : colors.rule;
      const [x0, y0] = toCanvas(tf, pts[i * 2] as number, pts[i * 2 + 1] as number);
      const [x1, y1] = toCanvas(tf, pts[i * 2 + 2] as number, pts[i * 2 + 3] as number);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  // Segment boundary ticks (6px across the path) and labels at each segment's midpoint.
  const [cxm, cym] = toCanvas(
    tf,
    (geometry.bounds.minX + geometry.bounds.maxX) / 2,
    (geometry.bounds.minY + geometry.bounds.maxY) / 2,
  );
  ctx.strokeStyle = colors.faint;
  ctx.fillStyle = colors.faint;
  ctx.lineWidth = 1;
  ctx.font = colors.font;
  ctx.textBaseline = 'middle';
  const starts = geometry.segmentStarts;
  starts.forEach((start, k) => {
    if (k > 0) {
      const p = poseOnGeometry(geometry, start);
      const [x, y] = toCanvas(tf, p.x, p.y);
      const th = (p.heading * Math.PI) / 180;
      const nx = Math.sin(th);
      const ny = Math.cos(th);
      ctx.beginPath();
      ctx.moveTo(x - nx * (TICK_PX / 2), y - ny * (TICK_PX / 2));
      ctx.lineTo(x + nx * (TICK_PX / 2), y + ny * (TICK_PX / 2));
      ctx.stroke();
    }
    const label = scene.segmentLabels[k];
    if (!label) return;
    const end = starts[k + 1] ?? geometry.totalLength;
    const mid = poseOnGeometry(geometry, (start + end) / 2);
    const [mx, my] = toCanvas(tf, mid.x, mid.y);
    const th = (mid.heading * Math.PI) / 180;
    // Canvas-space normal; pick the side away from the track's centre (the outside).
    let nx = Math.sin(th);
    let ny = Math.cos(th);
    if ((mx - cxm) * nx + (my - cym) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const text = label.toUpperCase();
    const tw = ctx.measureText(text).width;
    // Outside of the path unless that would leave the canvas; then inside.
    const fits = (sx: number, sy: number) => {
      const x = sx * 10;
      const y = sy * 10;
      const lx0 = mx + x;
      const ly0 = my + y;
      const left = sx > 0.5 ? lx0 : sx < -0.5 ? lx0 - tw : lx0 - tw / 2;
      return ly0 >= 8 && ly0 <= height - 8 && left >= 2 && left + tw <= width - 2;
    };
    if (!fits(nx, ny) && fits(-nx, -ny)) {
      nx = -nx;
      ny = -ny;
    }
    let lx = mx + nx * 10;
    const ly = my + ny * 10;
    ctx.textAlign = nx > 0.5 ? 'left' : nx < -0.5 ? 'right' : 'center';
    // Keep the label inside the canvas.
    if (ctx.textAlign === 'center') lx = Math.max(tw / 2 + 2, Math.min(width - tw / 2 - 2, lx));
    ctx.fillText(text, lx, Math.max(8, Math.min(height - 8, ly)));
  });

  // Best run: hollow --trace-best block, drawn under the current block.
  const drawBlock = (pose: Pose, fill: string | null, stroke: string) => {
    const c = blockCorners(tf, pose);
    ctx.beginPath();
    c.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };
  if (scene.best) drawBlock(scene.best, null, colors.best);
  drawBlock(scene.current, colors.text, colors.bg);
}
