/**
 * Fixture track with a corner: a 150 m launch straight, a 90° left-hander (r = 60 m) and a 120 m
 * exit straight. The start is at (0,0) heading +x (east), matching `TrackGeometry` (contract 01).
 * Heading is in degrees, counter-clockwise from east (a left turn increases it).
 */
import type { TrackGeometry } from '@/engine/types';

export const FIXTURE_LAUNCH = 150;
export const FIXTURE_RADIUS = 60;
export const FIXTURE_CORNER = (Math.PI / 2) * FIXTURE_RADIUS;
export const FIXTURE_EXIT = 120;
export const FIXTURE_LENGTH = FIXTURE_LAUNCH + FIXTURE_CORNER + FIXTURE_EXIT;
export const FIXTURE_SEGMENT_STARTS = [0, FIXTURE_LAUNCH, FIXTURE_LAUNCH + FIXTURE_CORNER];
export const FIXTURE_SEGMENT_LABELS = ['Launch', 'Turn 1', 'Exit'];

export interface Pose {
  x: number;
  y: number;
  /** Degrees, CCW from east. */
  heading: number;
}

/** Pose at distance `d` (m) along the fixture track (clamped to the track). */
export function fixturePoseAt(d: number): Pose {
  const s = Math.max(0, Math.min(FIXTURE_LENGTH, d));
  if (s <= FIXTURE_LAUNCH) return { x: s, y: 0, heading: 0 };
  if (s <= FIXTURE_LAUNCH + FIXTURE_CORNER) {
    const th = (s - FIXTURE_LAUNCH) / FIXTURE_RADIUS;
    return {
      x: FIXTURE_LAUNCH + FIXTURE_RADIUS * Math.sin(th),
      y: FIXTURE_RADIUS - FIXTURE_RADIUS * Math.cos(th),
      heading: (th * 180) / Math.PI,
    };
  }
  const e = s - FIXTURE_LAUNCH - FIXTURE_CORNER;
  return { x: FIXTURE_LAUNCH + FIXTURE_RADIUS, y: FIXTURE_RADIUS + e, heading: 90 };
}

/** The fixture geometry: one point every 1 m plus the end point. */
export function makeFixtureTrack(): TrackGeometry {
  const whole = Math.floor(FIXTURE_LENGTH);
  const count = whole + 2;
  const points = new Float32Array(count * 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = fixturePoseAt(i <= whole ? i : FIXTURE_LENGTH);
    points[i * 2] = p.x;
    points[i * 2 + 1] = p.y;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    points,
    totalLength: FIXTURE_LENGTH,
    segmentStarts: [...FIXTURE_SEGMENT_STARTS],
    bounds: { minX, minY, maxX, maxY },
  };
}
