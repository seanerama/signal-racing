/** Track layout, segment lookup, boundary interpolation and the top-down geometry (guarantee 9). */
import { describe, expect, it } from 'vitest';
import {
  crossingTime,
  curvature,
  poseAt,
  segmentAt,
  trackGeometry,
  trackLayout,
} from '@/engine/track';
import type { Track } from '@/engine/types';
import { TRACK_A1, TRACK_A4, TRACK_B1 } from './fixtures';

const deg = (rad: number): number => (rad * 180) / Math.PI;

describe('layout and lookup', () => {
  const layout = trackLayout(TRACK_A4);
  it('cumulative bounds', () => {
    expect(layout.starts).toEqual([0, 200, 200 + 40 * Math.PI]);
    expect(layout.total).toBeCloseTo(350 + 40 * Math.PI, 9);
  });
  it('segmentAt finds the containing segment from any hint', () => {
    expect(segmentAt(layout, 0)).toBe(0);
    expect(segmentAt(layout, 199.99)).toBe(0);
    expect(segmentAt(layout, 200)).toBe(1);
    expect(segmentAt(layout, 330, 0)).toBe(2);
    expect(segmentAt(layout, 10, 2)).toBe(0);
    expect(segmentAt(layout, 1e6)).toBe(2);
    expect(segmentAt(layout, -5)).toBe(0);
  });
  it('crossingTime interpolates within the step', () => {
    expect(crossingTime(1, 0.01, 99, 101, 100)).toBeCloseTo(1.005, 12);
    expect(crossingTime(1, 0.01, 100, 100, 100)).toBeCloseTo(1.01, 12);
  });
  it('curvature is signed: left positive', () => {
    expect(curvature(TRACK_A4.segments[1]!)).toBeCloseTo(1 / 80, 12);
    expect(curvature(TRACK_B1.segments[1]!)).toBeCloseTo(-1 / 150, 12);
    expect(curvature(TRACK_A4.segments[0]!)).toBe(0);
  });
});

describe('guarantee 9: trackGeometry', () => {
  it('a 90° left corner turns the heading by +90° ± 0.1°', () => {
    const layout = trackLayout(TRACK_A4);
    const end = poseAt(layout, layout.ends[1]!);
    expect(Math.abs(deg(end.heading) - 90)).toBeLessThan(0.1);
    // Same from the polyline tangent after the corner.
    const g = trackGeometry(TRACK_A4);
    const k = Math.floor(layout.ends[1]!) + 5;
    const p = g.points;
    const h = Math.atan2(p[2 * k + 3]! - p[2 * k + 1]!, p[2 * k + 2]! - p[2 * k]!);
    expect(Math.abs(deg(h) - 90)).toBeLessThan(0.1);
  });
  it('a 90° right corner turns the heading by −90° ± 0.1°', () => {
    const layout = trackLayout(TRACK_B1);
    expect(Math.abs(deg(poseAt(layout, layout.ends[1]!).heading) + 90)).toBeLessThan(0.1);
  });
  it('has a point every 1 m plus the end point, segment starts and bounds', () => {
    const g = trackGeometry(TRACK_A4);
    const total = 350 + 40 * Math.PI;
    expect(g.totalLength).toBeCloseTo(total, 9);
    expect(g.points.length / 2).toBe(Math.floor(total) + 2);
    expect(g.segmentStarts).toEqual(trackLayout(TRACK_A4).starts);
    // Start at the origin heading east; the corner ends 80 m north of its start.
    expect(g.points[0]).toBe(0);
    expect(g.points[1]).toBe(0);
    expect(g.bounds.minX).toBeCloseTo(0, 6);
    expect(g.bounds.maxX).toBeCloseTo(280, 3);
    expect(g.bounds.maxY).toBeCloseTo(80 + 150, 3);
    for (let i = 0; i + 3 < g.points.length - 2; i += 2) {
      const step = Math.hypot(g.points[i + 2]! - g.points[i]!, g.points[i + 3]! - g.points[i + 1]!);
      expect(step).toBeGreaterThan(0.999);
      expect(step).toBeLessThanOrEqual(1.00001); // Float32 points
    }
  });
  it('an integer-length track has no duplicate end point', () => {
    expect(trackGeometry(TRACK_A1).points.length / 2).toBe(1001);
  });
  it('is memoised by track id and shape', () => {
    expect(trackGeometry(TRACK_A4)).toBe(trackGeometry({ ...TRACK_A4 }));
    const other: Track = { ...TRACK_A4, segments: TRACK_A4.segments.slice(0, 2) };
    expect(trackGeometry(other)).not.toBe(trackGeometry(TRACK_A4));
  });
  it('evicts old entries beyond the cache bound without changing results', () => {
    for (let i = 0; i < 40; i++) {
      const t: Track = {
        ...TRACK_A1,
        id: `tmp${i}`,
        segments: [{ ...TRACK_A1.segments[0]!, length: 10 + i }],
      };
      expect(trackGeometry(t).totalLength).toBe(10 + i);
    }
  });
});
