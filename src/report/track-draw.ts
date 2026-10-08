/**
 * Pure drawing helpers for the top-down track view (design-system "Track view"; Stage 10 Lap Lab
 * treatment, re-implemented, not copied).
 *
 * World coordinates are metres, north-up, heading in degrees CCW from east (contract 01/02).
 * Canvas coordinates are CSS pixels with y pointing down, so the transform flips y. Nothing here
 * touches the DOM: `drawScene` takes a 2D context and draws one complete frame:
 *
 * 1. a faint square grid;
 * 2. the road as two stacked round-capped strokes along the real geometry (verge, asphalt);
 * 3. the racing line on the asphalt, coloured per metre by speed against the best run (lime
 *    faster by > 0.5 m/s, orange slower, neutral otherwise), or by the selected channel on the
 *    viridis ramp; during playback it is drawn only up to the car;
 * 4. a start bar (and a finish bar on point-to-point tracks) with labels, segment ticks and
 *    segment labels in mono;
 * 5. the ghost car of the best run (grey, 60 % alpha) and the current car: a top-down glyph with
 *    a restrained glow, a dark cockpit and front/rear wing bars, rotated to the heading.
 */
import type { TrackGeometry } from '@/engine/types';

export const TRACK_PAD = 18;
/** Top padding: room for the view's header row (title, legend) above the path. */
export const TRACK_PAD_TOP = 44;
/** Bottom padding: room for the START / FINISH labels under the road. */
export const TRACK_PAD_BOTTOM = 22;
/** Car block, scaled from 5.0 × 2.0 m, never smaller than 10 × 4 px (hit-testing, tests). */
export const BLOCK_LEN_M = 5;
export const BLOCK_WID_M = 2;
export const BLOCK_MIN_LEN_PX = 10;
export const BLOCK_MIN_WID_PX = 4;
/** The car glyph (px): body length × width, cockpit, wing bars (Lap Lab proportions). */
export const CAR_LEN_PX = 20;
export const CAR_WID_PX = 9;
/** m/s: a racing-line metre is "faster"/"slower" than the best run beyond this. */
export const LINE_DELTA_MS = 0.5;
/** px between grid lines. */
export const GRID_PX = 32;
const TICK_PX = 8;

/**
 * Default viridis stops (the `--seq-0…8` token values). The track path uses the upper part of the
 * ramp (`PATH_RAMP_FROM`) because the darkest stops vanish against the asphalt.
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

/** First `--seq-*` stop used for the track path (the darker stops are invisible on asphalt). */
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

/**
 * Fits `bounds` into a `width × height` canvas with `pad` px on each side (`padTop` on top,
 * `padBottom` at the bottom, defaulting to `pad`), centred.
 */
export function fitTransform(
  bounds: TrackGeometry['bounds'],
  width: number,
  height: number,
  pad = TRACK_PAD,
  padTop = pad,
  padBottom = pad,
): Transform {
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
  const bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const aw = Math.max(1, width - 2 * pad);
  const ah = Math.max(1, height - padBottom - padTop);
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

/** Racing-line class of a speed delta (current − best, m/s): +1 faster, −1 slower, 0 neutral. */
export function deltaClass(dv: number, threshold = LINE_DELTA_MS): -1 | 0 | 1 {
  if (!Number.isFinite(dv)) return 0;
  return dv > threshold ? 1 : dv < -threshold ? -1 : 0;
}

interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: LabelRect, b: LabelRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface SceneColors {
  grid: string;
  verge: string;
  asphalt: string;
  line: string;
  start: string;
  label: string;
  faint: string;
  text: string;
  bg: string;
  car: string;
  ghost: string;
  cockpit: string;
  faster: string;
  slower: string;
  font: string;
  smallFont: string;
  ramp: readonly string[];
  /** Kept for callers of the pre-Stage-10 scene (unused by the new drawing). */
  rule?: string;
  best?: string;
}

export interface Scene {
  /** CSS px. */
  width: number;
  height: number;
  dpr: number;
  geometry: TrackGeometry;
  colors: SceneColors;
  /** Per geometry point, normalised 0–1 (NaN = no data): colour-by-channel; null = off. */
  pathValues: ArrayLike<number> | null;
  /** Per geometry point: current − best speed (m/s), NaN where unknown; null = neutral line. */
  lineDelta?: ArrayLike<number> | null;
  /** Whether a racing line is drawn at all (after a run). */
  showLine?: boolean;
  /** Draw the racing line only up to this many metres (playback); null = all of it. */
  lineUpTo?: number | null;
  segmentLabels: string[];
  current: Pose;
  best: Pose | null;
  /** Whether the current car is drawn (a run exists). Defaults to true. */
  showCar?: boolean;
  /** Caption at the bottom-left, e.g. "RACING LINE · Δ SPEED VS BEST". */
  caption?: string;
  /** Whether to draw the faster/slower key next to the caption. */
  legend?: boolean;
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  pts: Float32Array,
  from: number,
  to: number,
): void {
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const [x, y] = toCanvas(tf, pts[i * 2] as number, pts[i * 2 + 1] as number);
    if (i === from) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Road widths (px) for a canvas: the verge and the asphalt, scaled to the view. */
export function roadWidths(width: number, height: number): { verge: number; asphalt: number } {
  const verge = Math.max(10, Math.min(20, Math.min(width, height) * 0.075));
  return { verge, asphalt: verge * 0.7 };
}

/** The top-down car glyph at `pose`: glow body, dark cockpit, front and rear wing bars. */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  tf: Transform,
  pose: Pose,
  color: string,
  cockpit: string,
  opts: { glow: boolean; alpha: number },
): void {
  const [cx, cy] = toCanvas(tf, pose.x, pose.y);
  const th = (pose.heading * Math.PI) / 180;
  ctx.save();
  ctx.translate(cx, cy);
  // Canvas y is down, so a CCW heading is a negative canvas rotation.
  ctx.rotate(-th);
  ctx.globalAlpha = opts.alpha;
  const L = CAR_LEN_PX;
  const W = CAR_WID_PX;
  if (opts.glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = color;
  ctx.fillRect(-L / 2, -W / 2 + 1, L, W - 2);
  ctx.shadowBlur = 0;
  // Front wing (at the nose, across) and rear wing (at the tail).
  ctx.fillRect(L / 2 - 1, -(W + 6) / 2, 3, W + 6);
  ctx.fillRect(-L / 2 - 2, -(W + 4) / 2, 3, W + 4);
  // Cockpit.
  ctx.fillStyle = cockpit;
  ctx.fillRect(-3, -W / 2 + 2.5, 6, W - 5);
  ctx.restore();
}

/** Draws one complete frame. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { width, height, dpr, geometry, colors } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const { verge, asphalt } = roadWidths(width, height);
  const pad = TRACK_PAD + verge / 2;
  const tf = fitTransform(
    geometry.bounds,
    width,
    height,
    pad,
    TRACK_PAD_TOP + verge / 2,
    TRACK_PAD_BOTTOM + verge / 2,
  );
  const pts = geometry.points;
  const count = pts.length / 2;

  // 1. Faint grid.
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = colors.grid;
  ctx.beginPath();
  for (let x = GRID_PX / 2; x < width; x += GRID_PX) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = GRID_PX / 2; y < height; y += GRID_PX) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();

  if (count < 2) return;

  // 2. Road: verge, then asphalt, round caps and joins.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = verge;
  ctx.strokeStyle = colors.verge;
  strokePath(ctx, tf, pts, 0, count - 1);
  ctx.lineWidth = asphalt;
  ctx.strokeStyle = colors.asphalt;
  strokePath(ctx, tf, pts, 0, count - 1);

  // 3. Racing line (after a run): by channel (viridis) or by speed delta against the best.
  if (scene.showLine ?? true) {
    const end = Math.max(
      0,
      Math.min(count - 1, Math.floor(scene.lineUpTo ?? Number.POSITIVE_INFINITY)),
    );
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    const colourAt = (i: number): string => {
      if (scene.pathValues) {
        const v = scene.pathValues[i] as number;
        return Number.isFinite(v) ? rampColor(v, colors.ramp) : colors.line;
      }
      const d = scene.lineDelta ? deltaClass(scene.lineDelta[i] as number) : 0;
      return d > 0 ? colors.faster : d < 0 ? colors.slower : colors.line;
    };
    // Batch consecutive metres of one colour into one stroke.
    let runStart = 0;
    let runColour = colourAt(0);
    for (let i = 1; i < end; i++) {
      const c = colourAt(i);
      if (c !== runColour) {
        ctx.strokeStyle = runColour;
        strokePath(ctx, tf, pts, runStart, i);
        runStart = i;
        runColour = c;
      }
    }
    if (end > runStart) {
      ctx.strokeStyle = runColour;
      strokePath(ctx, tf, pts, runStart, end);
    }
  }

  // 4. Start (and finish) bars, segment ticks and labels. Labels never overlap one another or
  //    the header row: each tries the outside of the road, then the inside, then further out,
  //    and is left out if nothing fits (the strips' segment rules still name it).
  const placed: LabelRect[] = [];
  const minY = TRACK_PAD_TOP - 2;
  // The road, as small boxes every few metres: labels keep off it where they can.
  const road: LabelRect[] = [];
  const stepM = Math.max(2, Math.floor(verge / Math.max(tf.scale, 1e-6) / 2));
  for (let i = 0; i < count; i += stepM) {
    const [x, y] = toCanvas(tf, pts[i * 2] as number, pts[i * 2 + 1] as number);
    road.push({ x: x - verge / 2, y: y - verge / 2, w: verge, h: verge });
  }
  const place = (text: string, cands: Array<[number, number]>, font: string): void => {
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    // First pass: clear of other labels and of the road; second pass: clear of labels only.
    for (const avoidRoad of [true, false]) {
      for (const [left0, cy] of cands) {
        const left = Math.max(2, Math.min(width - tw - 2, left0));
        const r = { x: left - 2, y: cy - 6, w: tw + 4, h: 12 };
        if (r.y < minY || r.y + r.h > height - 2) continue;
        if (placed.some((q) => overlaps(q, r))) continue;
        if (avoidRoad && road.some((q) => overlaps(q, r))) continue;
        placed.push(r);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, left, cy);
        return;
      }
    }
  };
  const bar = (d: number, label: string) => {
    const p = poseOnGeometry(geometry, d);
    const [x, y] = toCanvas(tf, p.x, p.y);
    const th = (p.heading * Math.PI) / 180;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-th);
    ctx.fillStyle = colors.start;
    ctx.fillRect(-2, -(verge + 6) / 2, 4, verge + 6);
    ctx.restore();
    ctx.fillStyle = colors.label;
    ctx.font = colors.smallFont;
    const tw = ctx.measureText(label).width;
    const below = y + verge / 2 + 10;
    const above = y - verge / 2 - 10;
    place(
      label,
      [
        [x - tw / 2, below],
        [x - tw / 2, above],
        [x + verge / 2 + 6, y],
        [x - verge / 2 - 6 - tw, y],
      ],
      colors.smallFont,
    );
  };
  const first = poseOnGeometry(geometry, 0);
  const last = poseOnGeometry(geometry, geometry.totalLength);
  const [sx, sy] = toCanvas(tf, first.x, first.y);
  const [ex, ey] = toCanvas(tf, last.x, last.y);
  const closed = Math.hypot(ex - sx, ey - sy) < verge * 2;
  bar(0, closed ? 'START / FINISH' : 'START');
  if (!closed) bar(geometry.totalLength, 'FINISH');

  const [cxm, cym] = toCanvas(
    tf,
    (geometry.bounds.minX + geometry.bounds.maxX) / 2,
    (geometry.bounds.minY + geometry.bounds.maxY) / 2,
  );
  ctx.strokeStyle = colors.faint;
  ctx.lineWidth = 1;
  const starts = geometry.segmentStarts;
  const off = verge / 2 + 10;
  starts.forEach((start, k) => {
    if (k > 0) {
      const p = poseOnGeometry(geometry, start);
      const [x, y] = toCanvas(tf, p.x, p.y);
      const th = (p.heading * Math.PI) / 180;
      const nx = Math.sin(th);
      const ny = Math.cos(th);
      const h = (verge + TICK_PX) / 2;
      ctx.beginPath();
      ctx.moveTo(x - nx * h, y - ny * h);
      ctx.lineTo(x + nx * h, y + ny * h);
      ctx.stroke();
    }
  });
  ctx.fillStyle = colors.label;
  starts.forEach((start, k) => {
    const label = scene.segmentLabels[k];
    if (!label) return;
    const end = starts[k + 1] ?? geometry.totalLength;
    const mid = poseOnGeometry(geometry, (start + end) / 2);
    const [mx, my] = toCanvas(tf, mid.x, mid.y);
    const th = (mid.heading * Math.PI) / 180;
    // Canvas-space normal; prefer the side away from the track's centre (the outside).
    let nx = Math.sin(th);
    let ny = Math.cos(th);
    if ((mx - cxm) * nx + (my - cym) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    // A straight's centre is on the path: hang its label above (north) the road.
    if (Math.abs((mx - cxm) * nx + (my - cym) * ny) < 1 && ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const text = label.toUpperCase();
    ctx.font = colors.font;
    const tw = ctx.measureText(text).width;
    const at = (sxn: number, syn: number, dist: number): [number, number] => {
      const ax = mx + sxn * dist;
      const left = sxn > 0.5 ? ax : sxn < -0.5 ? ax - tw : ax - tw / 2;
      return [left, my + syn * dist];
    };
    place(
      text,
      [
        at(nx, ny, off),
        at(-nx, -ny, off),
        at(nx, ny, off + 12),
        at(-nx, -ny, off + 12),
        at(nx, ny, off + 26),
        at(-nx, -ny, off + 26),
      ],
      colors.font,
    );
  });

  // Caption and the faster/slower key, bottom-left.
  if (scene.caption) {
    ctx.font = colors.smallFont;
    ctx.fillStyle = colors.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const y = height - 11;
    ctx.fillText(scene.caption, 10, y);
    if (scene.legend) {
      let x = 10 + ctx.measureText(scene.caption).width + 12;
      for (const [c, w] of [
        [colors.faster, 'FASTER'],
        [colors.slower, 'SLOWER'],
      ] as const) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y - 1, 10, 2);
        x += 14;
        ctx.fillStyle = colors.label;
        ctx.fillText(w, x, y);
        x += ctx.measureText(w).width + 10;
      }
    }
  }

  // 5. Cars: the best run's ghost, then the current car on top.
  if (scene.best) {
    drawCar(ctx, tf, scene.best, colors.ghost, colors.cockpit, { glow: false, alpha: 0.6 });
  }
  if (scene.showCar ?? true) {
    drawCar(ctx, tf, scene.current, colors.car, colors.cockpit, { glow: true, alpha: 1 });
  }
}
