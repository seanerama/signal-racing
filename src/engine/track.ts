/**
 * Track layout: cumulative segment bounds, segment lookup, boundary-crossing interpolation, and
 * the top-down geometry (start at (0,0) heading +x/east; `left` turns counter-clockwise).
 * The car follows the path exactly (no yaw dynamics), so its pose is a pure function of `s`.
 */
import type { Segment, Track, TrackGeometry } from './types';

/** A pose on the path: metres and radians (heading 0 = +x, counter-clockwise positive). */
export interface Pose {
  x: number;
  y: number;
  heading: number;
}

/** Precomputed per-track layout. */
export interface TrackLayout {
  segments: readonly Segment[];
  /** m, cumulative start of each segment. */
  starts: number[];
  /** m, cumulative end of each segment. */
  ends: number[];
  /** m. */
  total: number;
  /** Pose at the start of each segment. */
  startPoses: Pose[];
}

/** Signed curvature of a segment in 1/m: `+1/r` for a left (CCW) corner, `−1/r` right, 0 straight. */
export function curvature(seg: Segment): number {
  if (seg.kind !== 'corner' || !seg.radius) return 0;
  return seg.direction === 'right' ? -1 / seg.radius : 1 / seg.radius;
}

/** Pose at distance `ds` into a segment that starts at `p0` (exact for straights and arcs). */
function advancePose(p0: Pose, seg: Segment, ds: number, out: Pose): Pose {
  const k = curvature(seg);
  if (k === 0) {
    out.x = p0.x + ds * Math.cos(p0.heading);
    out.y = p0.y + ds * Math.sin(p0.heading);
    out.heading = p0.heading;
    return out;
  }
  // Arc: heading turns by k·ds; chord integration in closed form.
  const h1 = p0.heading + k * ds;
  out.x = p0.x + (Math.sin(h1) - Math.sin(p0.heading)) / k;
  out.y = p0.y - (Math.cos(h1) - Math.cos(p0.heading)) / k;
  out.heading = h1;
  return out;
}

/** Builds the cumulative bounds and the start pose of every segment. */
export function trackLayout(track: Track): TrackLayout {
  const starts: number[] = [];
  const ends: number[] = [];
  const startPoses: Pose[] = [];
  let s = 0;
  let pose: Pose = { x: 0, y: 0, heading: 0 };
  for (const seg of track.segments) {
    starts.push(s);
    startPoses.push(pose);
    s += seg.length;
    ends.push(s);
    pose = advancePose(pose, seg, seg.length, { x: 0, y: 0, heading: 0 });
  }
  return { segments: track.segments, starts, ends, total: s, startPoses };
}

/**
 * Index of the segment containing `s` (the last one whose start is ≤ s; clamped to the track).
 * `hint` is a starting index for a forward scan, which makes the integrator's lookups O(1).
 */
export function segmentAt(layout: TrackLayout, s: number, hint = 0): number {
  const last = layout.starts.length - 1;
  let i = Math.min(Math.max(hint, 0), last);
  while (i > 0 && s < (layout.starts[i] ?? 0)) i--;
  while (i < last && s >= (layout.ends[i] ?? Infinity)) i++;
  return i;
}

/** Pose of the car at distance `s` along the path (clamped to `[0, total]`). */
export function poseAt(
  layout: TrackLayout,
  s: number,
  out: Pose = { x: 0, y: 0, heading: 0 },
  hint = 0,
): Pose {
  const sc = Math.min(Math.max(s, 0), layout.total);
  const i = segmentAt(layout, sc, hint);
  const seg = layout.segments[i];
  const p0 = layout.startPoses[i];
  if (!seg || !p0) {
    out.x = 0;
    out.y = 0;
    out.heading = 0;
    return out;
  }
  return advancePose(p0, seg, sc - (layout.starts[i] ?? 0), out);
}

/**
 * Time at which a step from `(t0, s0)` to `(t0 + dt, s1)` crosses `boundary`, by linear
 * interpolation within the step (contract 02 "Segments").
 */
export function crossingTime(
  t0: number,
  dt: number,
  s0: number,
  s1: number,
  boundary: number,
): number {
  if (s1 <= s0) return t0 + dt;
  const f = Math.min(1, Math.max(0, (boundary - s0) / (s1 - s0)));
  return t0 + f * dt;
}

/** Stable fingerprint of a track's geometry (id plus every segment's shape). */
function fingerprint(track: Track): string {
  let key = track.id;
  for (const seg of track.segments) {
    key += `|${seg.kind}:${seg.length}:${seg.radius ?? ''}:${seg.direction ?? ''}`;
  }
  return key;
}

/** Bounded memo for `trackGeometry`. It holds derived data only and never changes a result. */
const GEOMETRY_CACHE = new Map<string, TrackGeometry>();
const GEOMETRY_CACHE_MAX = 32;

/**
 * Top-down geometry: one point every 1 m along the path (plus the end point), segment starts and
 * bounds. Pure; memoised by track id and segment shapes. Treat the result as read-only.
 */
export function trackGeometry(track: Track): TrackGeometry {
  const key = fingerprint(track);
  const hit = GEOMETRY_CACHE.get(key);
  if (hit) return hit;

  const layout = trackLayout(track);
  const whole = Math.floor(layout.total);
  const count = whole + (layout.total - whole > 1e-9 ? 2 : 1);
  const points = new Float32Array(count * 2);
  const pose: Pose = { x: 0, y: 0, heading: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hint = 0;
  for (let k = 0; k < count; k++) {
    const s = Math.min(k, layout.total);
    hint = segmentAt(layout, s, hint);
    poseAt(layout, s, pose, hint);
    points[2 * k] = pose.x;
    points[2 * k + 1] = pose.y;
    if (pose.x < minX) minX = pose.x;
    if (pose.y < minY) minY = pose.y;
    if (pose.x > maxX) maxX = pose.x;
    if (pose.y > maxY) maxY = pose.y;
  }
  const geometry: TrackGeometry = {
    points,
    totalLength: layout.total,
    segmentStarts: layout.starts.slice(),
    bounds: { minX, minY, maxX, maxY },
  };
  if (GEOMETRY_CACHE.size >= GEOMETRY_CACHE_MAX) {
    const oldest = GEOMETRY_CACHE.keys().next().value;
    if (oldest !== undefined) GEOMETRY_CACHE.delete(oldest);
  }
  GEOMETRY_CACHE.set(key, geometry);
  return geometry;
}
