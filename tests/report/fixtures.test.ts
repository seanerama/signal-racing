import { describe, expect, it } from 'vitest';
import { indexAtOrBefore } from '@/report/align';
import {
  FIXTURE_LAUNCH,
  FIXTURE_CORNER,
  fixtureChannelIds,
  makeReportFixture,
} from '@/report/__fixtures__';

describe('report fixtures', () => {
  it('builds 12-, 40- and 200-channel sets with unique snake_case ids', () => {
    for (const size of [12, 40, 200] as const) {
      const ids = fixtureChannelIds(size);
      expect(ids).toHaveLength(size);
      expect(new Set(ids).size).toBe(size);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('the best run is faster than the current run', () => {
    const fx = makeReportFixture(12);
    expect(fx.bestTime).toBeLessThan(fx.currentTime);
    expect(fx.currentTime).toBeGreaterThan(5);
    expect(fx.currentTime).toBeLessThan(30);
  });

  it('the current run has dropouts (NaN) on noisy channels, never on the pose', () => {
    const fx = makeReportFixture(40);
    expect(fx.currentSummary.stats['speed']?.dropouts ?? 0).toBeGreaterThanOrEqual(0);
    const total = fx.ids.reduce((acc, id) => acc + (fx.currentSummary.stats[id]?.dropouts ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    for (const id of ['pos_x', 'pos_y', 'heading']) {
      expect(fx.current.get(id).some((v) => Number.isNaN(v))).toBe(false);
    }
  });

  it('lat_g rises through the corner and is zero on the launch straight', () => {
    const fx = makeReportFixture(12);
    const lat = fx.current.getClean('lat_g');
    const s = fx.current.s;
    const iLaunch = indexAtOrBefore(s, FIXTURE_LAUNCH - 20);
    const iMid = indexAtOrBefore(s, FIXTURE_LAUNCH + FIXTURE_CORNER / 2);
    expect(lat[iLaunch]).toBe(0);
    expect(lat[iMid]).toBeGreaterThan(1);
  });

  it('heading turns 90° through the corner; positions lie on the geometry', () => {
    const fx = makeReportFixture(12);
    const h = fx.current.getClean('heading');
    expect(h[0]).toBe(0);
    expect(h[fx.current.n - 1]).toBeCloseTo(90, 3);
    const { bounds } = fx.track;
    const x = fx.current.getClean('pos_x');
    const y = fx.current.getClean('pos_y');
    for (let i = 0; i < fx.current.n; i += 50) {
      expect(x[i]).toBeGreaterThanOrEqual(bounds.minX - 1e-3);
      expect(x[i]).toBeLessThanOrEqual(bounds.maxX + 1e-3);
      expect(y[i]).toBeGreaterThanOrEqual(bounds.minY - 1e-3);
      expect(y[i]).toBeLessThanOrEqual(bounds.maxY + 1e-3);
    }
  });

  it('rear_slip_ratio peaks at launch in the current run, and the summary window finds it', () => {
    const fx = makeReportFixture(12);
    const st = fx.currentSummary.stats['rear_slip_ratio'];
    expect(st?.max).toBeGreaterThan(0.15);
    const w = fx.currentSummary.window('rear_slip_ratio', (v) => v > 0.1);
    expect(w).not.toBeNull();
    expect(w!.tStart).toBeGreaterThan(0.3);
    expect(w!.tEnd).toBeLessThan(1.1);
  });

  it('get() is deterministic', () => {
    const a = makeReportFixture(12).current.get('speed');
    const b = makeReportFixture(12).current.get('speed');
    expect(a).toBe(b);
  });
});
