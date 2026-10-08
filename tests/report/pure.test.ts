import { describe, expect, it } from 'vitest';
import { indexAtOrBefore, interpAt, nearestIndex, resampleOnto } from '@/report/align';
import { insertStrip, moveBy, removeStrip, toggleStrip } from '@/report/strip-ops';
import {
  blockCorners,
  BLOCK_MIN_LEN_PX,
  fitTransform,
  luminance,
  normalize,
  poseOnGeometry,
  rampColor,
  toCanvas,
  TRACK_PAD,
  TRACK_PAD_TOP,
  VIRIDIS,
} from '@/report/track-draw';
import {
  buildStripOptions,
  formatTick,
  paddedRange,
  slotToken,
  X_AXIS_H,
  yTicks,
} from '@/report/uplot-theme';
import { makeFixtureTrack } from '@/report/__fixtures__';

describe('align', () => {
  const xs = [0, 1, 2, 3];
  const ys = [0, 10, NaN, 30];

  it('indexAtOrBefore / nearestIndex', () => {
    expect(indexAtOrBefore(xs, -1)).toBe(-1);
    expect(indexAtOrBefore(xs, 0)).toBe(0);
    expect(indexAtOrBefore(xs, 2.5)).toBe(2);
    expect(indexAtOrBefore(xs, 9)).toBe(3);
    expect(nearestIndex(xs, 1.4)).toBe(1);
    expect(nearestIndex(xs, 1.6)).toBe(2);
    expect(nearestIndex(xs, 99)).toBe(3);
  });

  it('interpAt interpolates linearly, NaN next to a dropout or outside the range', () => {
    expect(interpAt(xs, ys, 0.5)).toBe(5);
    expect(interpAt(xs, ys, 1.5)).toBeNaN();
    expect(interpAt(xs, ys, -0.1)).toBeNaN();
    expect(interpAt(xs, ys, 3.1)).toBeNaN();
    expect(interpAt(xs, ys, 3)).toBe(30);
  });

  it('resampleOnto matches interpAt everywhere and keeps gaps', () => {
    const dst = [-1, 0, 0.25, 1, 1.5, 2.5, 3, 4];
    const out = resampleOnto(xs, ys, dst);
    dst.forEach((x, i) => {
      const e = interpAt(xs, ys, x);
      if (Number.isNaN(e)) expect(out[i]).toBeNaN();
      else expect(out[i]).toBeCloseTo(e, 9);
    });
  });

  it('resampling a run onto its own x is the identity', () => {
    const x = Float32Array.from({ length: 50 }, (_, i) => i * 0.01);
    const y = Float32Array.from({ length: 50 }, (_, i) => Math.sin(i));
    const out = resampleOnto(x, y, x);
    for (let i = 0; i < 50; i++) expect(out[i]).toBeCloseTo(y[i]!, 6);
  });
});

describe('strip-ops', () => {
  const L = ['a', 'b', 'c', 'd'];
  it('remove / toggle', () => {
    expect(removeStrip(L, 'b')).toEqual(['a', 'c', 'd']);
    expect(toggleStrip(L, 'b')).toEqual(['a', 'c', 'd']);
    expect(toggleStrip(L, 'x')).toEqual([...L, 'x']);
  });
  it('insert new ids at a position; move existing ones', () => {
    expect(insertStrip(L, 'x', 0)).toEqual(['x', 'a', 'b', 'c', 'd']);
    expect(insertStrip(L, 'x', 4)).toEqual([...L, 'x']);
    expect(insertStrip(L, 'a', 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(insertStrip(L, 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(insertStrip(L, 'b', 2)).toEqual(L);
  });
  it('moveBy clamps', () => {
    expect(moveBy(L, 'a', -1)).toEqual(L);
    expect(moveBy(L, 'a', 1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveBy(L, 'd', -2)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('never mutates the input', () => {
    const copy = L.slice();
    insertStrip(L, 'a', 3);
    moveBy(L, 'a', 2);
    removeStrip(L, 'a');
    expect(L).toEqual(copy);
  });
});

describe('track-draw', () => {
  const geom = makeFixtureTrack();

  it('fitTransform keeps the whole path inside the canvas with padding', () => {
    for (const [w, h] of [
      [320, 200],
      [400, 240],
      [180, 400],
      [1000, 120],
    ] as const) {
      const tf = fitTransform(geom.bounds, w, h, TRACK_PAD, TRACK_PAD_TOP);
      for (let i = 0; i < geom.points.length; i += 2) {
        const [x, y] = toCanvas(tf, geom.points[i]!, geom.points[i + 1]!);
        expect(x).toBeGreaterThanOrEqual(TRACK_PAD - 1e-6);
        expect(x).toBeLessThanOrEqual(w - TRACK_PAD + 1e-6);
        expect(y).toBeGreaterThanOrEqual(TRACK_PAD_TOP - 1e-6);
        expect(y).toBeLessThanOrEqual(h - TRACK_PAD + 1e-6);
      }
    }
  });

  it('is north-up: larger world y is higher on the canvas', () => {
    const tf = fitTransform(geom.bounds, 320, 200);
    expect(toCanvas(tf, 0, 100)[1]).toBeLessThan(toCanvas(tf, 0, 0)[1]);
  });

  it("the block's long axis points along the heading, and respects the minimum size", () => {
    const tf = fitTransform(geom.bounds, 320, 200);
    for (const heading of [0, 30, 90, 135, -45, 180]) {
      const c = blockCorners(tf, { x: 100, y: 50, heading });
      const [fl, fr, rr, rl] = c as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
      // Front-centre minus rear-centre = direction of travel (canvas y is down).
      const fx = (fl[0] + fr[0]) / 2 - (rl[0] + rr[0]) / 2;
      const fy = (fl[1] + fr[1]) / 2 - (rl[1] + rr[1]) / 2;
      const ang = (Math.atan2(-fy, fx) * 180) / Math.PI;
      const diff = ((ang - heading + 540) % 360) - 180;
      expect(Math.abs(diff)).toBeLessThan(1e-6);
      expect(Math.hypot(fx, fy)).toBeGreaterThanOrEqual(BLOCK_MIN_LEN_PX - 1e-9);
    }
  });

  it('poseOnGeometry follows the corner: heading 90° on the exit straight', () => {
    expect(poseOnGeometry(geom, 0).heading).toBeCloseTo(0, 3);
    expect(poseOnGeometry(geom, geom.totalLength - 5).heading).toBeCloseTo(90, 1);
  });

  it('the viridis ramp is monotonic in luminance; normalize clamps', () => {
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const l = luminance(rampColor(i / 50));
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
    expect(rampColor(0)).toBe('rgb(68, 1, 84)');
    expect(rampColor(1)).toBe('rgb(253, 231, 37)');
    expect(rampColor(2)).toBe(rampColor(1));
    const sub = VIRIDIS.slice(2);
    expect(luminance(rampColor(0, sub))).toBeGreaterThan(luminance(rampColor(0)));
    expect(normalize(5, 0, 10)).toBe(0.5);
    expect(normalize(20, 0, 10)).toBe(1);
    expect(normalize(NaN, 0, 10)).toBeNaN();
    expect(normalize(3, 3, 3)).toBe(0.5);
  });
});

describe('uplot-theme', () => {
  const base = {
    slot: 0,
    quantity: 'speed' as const,
    units: 'metric' as const,
    height: 72,
    showXAxis: false,
    syncKey: 'k',
    projector: false,
  };

  it('series: best first in --trace-best, current in the slot hue; widths per mode', () => {
    const o = buildStripOptions({ ...base, slot: 2 });
    expect(o.series).toHaveLength(3);
    expect(o.series[1]!.stroke).toBe('#7a8494b3');
    expect(o.series[2]!.stroke).toBe('#f062c0');
    expect(o.series[2]!.width).toBe(1.5);
    expect(o.series[1]!.width).toBe(1);
    const p = buildStripOptions({ ...base, projector: true });
    expect(p.series[2]!.width).toBe(2.5);
    expect(p.series[1]!.width).toBe(1.5);
  });

  it('only the bottom strip gets x-axis labels and the extra height', () => {
    const top = buildStripOptions(base);
    const bottom = buildStripOptions({ ...base, showXAxis: true });
    expect(top.axes![0]!.size).toBe(0);
    expect(bottom.axes![0]!.size).toBe(X_AXIS_H);
    expect(bottom.height).toBe(72 + X_AXIS_H);
    expect(top.height).toBe(72);
  });

  it('cursor is synced by key, plain drags do not zoom, legend hidden', () => {
    const o = buildStripOptions(base);
    expect(o.cursor?.sync?.key).toBe('k');
    expect(o.cursor?.drag?.setScale).toBe(false);
    expect(o.legend?.show).toBe(false);
  });

  it('slot tokens cycle after 8', () => {
    expect(slotToken(0)).toBe('--t1');
    expect(slotToken(7)).toBe('--t8');
    expect(slotToken(8)).toBe('--t1');
  });

  it('y ticks: at most 3, inside the range; range pads the union by 5%', () => {
    for (const [a, b] of [
      [0, 200],
      [-1.6, 0.6],
      [-0.008, 0.19],
      [4000, 12644],
      [0, 0.001],
    ] as const) {
      const t = yTicks(a, b);
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(3);
      for (const v of t) {
        expect(v).toBeGreaterThanOrEqual(a - 1e-9);
        expect(v).toBeLessThanOrEqual(b + 1e-9);
      }
    }
    expect(paddedRange(0, 100)).toEqual([-5, 105]);
    expect(paddedRange(null, null)).toEqual([0, 1]);
    expect(formatTick(-0, 1)).toBe('0');
    expect(formatTick(-1, 1)).toBe('−1');
    expect(formatTick(0.1, 0.1)).toBe('0.1');
  });
});
