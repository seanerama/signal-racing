/** Stage 9 pure helpers: display smoothing and the grip circle maths. */
import { describe, expect, it } from 'vitest';
import {
  circleLayout,
  isOutside,
  normalizeForce,
  radiusOf,
  toCirclePx,
  trailWindow,
} from '@/report/grip-circle-draw';
import { smooth5 } from '@/report/smooth';

describe('smooth5 (5-point centred mean)', () => {
  it('averages i−2…i+2 in the interior', () => {
    const y = smooth5([0, 0, 5, 0, 0, 10, 0]);
    expect(y[2]).toBeCloseTo(1, 12);
    expect(y[3]).toBeCloseTo(3, 12);
    expect(y[4]).toBeCloseTo(3, 12);
  });
  it('clips the window at the ends', () => {
    const y = smooth5([3, 6, 9, 12]);
    expect(y[0]).toBeCloseTo((3 + 6 + 9) / 3, 12);
    expect(y[1]).toBeCloseTo((3 + 6 + 9 + 12) / 4, 12);
    expect(y[3]).toBeCloseTo((6 + 9 + 12) / 3, 12);
  });
  it('is NaN-aware: neighbours skip dropouts, a dropout stays a gap', () => {
    const y = smooth5([1, NaN, 3, 5, 7]);
    expect(Number.isNaN(y[1])).toBe(true);
    expect(y[2]).toBeCloseTo((1 + 3 + 5 + 7) / 4, 12);
    expect(y[0]).toBeCloseTo((1 + 3) / 2, 12);
  });
  it('leaves a constant unchanged and does not mutate its input', () => {
    const x = new Float32Array([2, 2, 2, 2, 2, 2]);
    expect([...smooth5(x)]).toEqual([2, 2, 2, 2, 2, 2]);
    expect([...x]).toEqual([2, 2, 2, 2, 2, 2]);
    expect(smooth5([])).toHaveLength(0);
  });
});

describe('grip circle helpers', () => {
  it('normalises by the axle budget', () => {
    expect(normalizeForce(3000, 4000, 10000)).toEqual({ x: 0.3, y: 0.4 });
    expect(radiusOf(normalizeForce(3000, 4000, 10000))).toBeCloseTo(0.5, 12);
    expect(Number.isNaN(normalizeForce(1, 1, 0).x)).toBe(true);
    expect(Number.isNaN(normalizeForce(NaN, 1, 10).x)).toBe(true);
  });
  it('detects a dot outside the circle', () => {
    expect(isOutside({ x: 0.6, y: 0.8 })).toBe(false);
    expect(isOutside({ x: 0.61, y: 0.8 })).toBe(true);
    expect(isOutside({ x: -1.01, y: 0 })).toBe(true);
  });
  it('trail window covers the last 0.5 s, clamped to the run', () => {
    const t = Array.from({ length: 200 }, (_, i) => i * 0.01);
    expect(trailWindow(t, 150)).toEqual([100, 150]);
    expect(trailWindow(t, 20)).toEqual([0, 20]);
    expect(trailWindow(t, 500)).toEqual([149, 199]);
    expect(trailWindow([], 3)).toEqual([0, -1]);
  });
  it('layout: two circles side by side; lateral right, drive up', () => {
    const l = circleLayout(400, 96);
    expect(l.front.cx).toBeLessThan(l.rear.cx);
    expect(l.front.cy).toBe(l.rear.cy);
    expect(l.front.r).toBeGreaterThan(10);
    const [x, y] = toCirclePx(l.front, { x: 1, y: 0 });
    expect(x).toBeCloseTo(l.front.cx, 9);
    expect(y).toBeCloseTo(l.front.cy - l.front.r, 9);
    const [x2] = toCirclePx(l.front, { x: 0, y: 1 });
    expect(x2).toBeCloseTo(l.front.cx + l.front.r, 9);
  });
});
