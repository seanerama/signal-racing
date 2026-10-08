import { describe, expect, it, vi } from 'vitest';
import { simulate } from '@/engine/index';
import { configHash, gridKey, stableStringify } from '@/game/config-hash';
import {
  EXHAUSTIVE_LIMIT,
  evenIndices,
  gridSearch,
  gridSize,
  leverGrid,
  PROGRESS_INTERVAL_MS,
} from '@/game/grid-search';
import { STUB_A2 } from './stub-level';
import type { LevelConfig } from '@/levels/types';
import { buildBaseSimInput } from '@/worker/build-input';
import { BENCH_A3, BENCH_B1L, WEIGHT } from './bench-levels';

vi.setConfig({ testTimeout: 120_000 });

/** A 3-lever level small enough to enumerate quickly (ramp × pressure × weight, coarser steps). */
const SMALL3: LevelConfig = {
  ...BENCH_A3,
  levers: [
    { ...STUB_A2.levers[0]!, step: 0.3 }, // 6 points
    { ...STUB_A2.levers[1]!, step: 0.2 }, // 6 points
    { ...WEIGHT, step: 0.02 }, // 8 points
  ],
};

describe('lever grids', () => {
  it('builds exact step points', () => {
    expect(leverGrid(STUB_A2.levers[0]!)).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5,
    ]);
    expect(leverGrid(WEIGHT)).toEqual([0.38, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.52]);
  });

  it('coarse indices are evenly spaced with endpoints', () => {
    expect(evenIndices(16, 6)).toEqual([0, 3, 6, 9, 12, 15]);
    expect(evenIndices(9, 6)).toEqual([0, 2, 3, 5, 6, 8]);
    expect(evenIndices(4, 6)).toEqual([0, 1, 2, 3]);
  });

  it('gridSize counts unlocked levers only', () => {
    expect(gridSize(STUB_A2)).toBe(176);
    expect(gridSize(SMALL3)).toBe(288);
    expect(gridSize(BENCH_B1L)).toBeGreaterThan(EXHAUSTIVE_LIMIT);
  });
});

describe('grid search', () => {
  it.each([
    ['small 3-lever', SMALL3, 288],
    ['A3 shape (full grid)', BENCH_A3, 1408],
  ] as const)('exhaustive and coarse→fine find the same optimum: %s', (_name, level, points) => {
    const ex = gridSearch(level);
    const cf = gridSearch(level, { forceCoarse: true });
    expect(ex.evaluated).toBe(points);
    expect(cf.evaluated).toBeLessThan(ex.evaluated);
    expect(cf.optimum.setup).toEqual(ex.optimum.setup);
    expect(cf.optimum.outcome.totalTime).toBe(ex.optimum.outcome.totalTime);
    expect(cf.target).toBe(ex.target);
  });

  it('result fields: target, samples, floors, hash', () => {
    const g = gridSearch(STUB_A2);
    expect(g.levelId).toBe('A2');
    expect(g.configHash).toBe(configHash(STUB_A2));
    expect(g.target).toBeCloseTo(g.optimum.outcome.totalTime * 1.01, 12);
    expect(g.samples).toHaveLength(g.evaluated);
    const best = Math.min(...g.samples.map((s) => s.totalTime));
    expect(g.optimum.outcome.totalTime).toBe(best);
    // Locked levers are applied to every sample.
    for (const s of g.samples) expect([s.setup.weight_dist, s.setup.wing]).toEqual([0.45, 4]);
    // The optimum outcome is exactly what the engine gives for that setup.
    const again = simulate(buildBaseSimInput(STUB_A2, g.optimum.setup), 'fast').outcome;
    expect(again).toEqual(g.optimum.outcome);
    expect(g.ms).toBeGreaterThanOrEqual(0);
  });

  it('segmentFloors[i] ≤ that segment time at the optimum, for every i (multi-segment)', () => {
    // B1L shape with a reduced grid so the test stays fast.
    const level: LevelConfig = {
      ...BENCH_B1L,
      levers: BENCH_B1L.levers.map((l) =>
        l.id === 'throttle_ramp'
          ? { ...l, step: 0.5 }
          : l.id === 'tire_pressure'
            ? { ...l, step: 0.5 }
            : l,
      ),
    };
    const g = gridSearch(level);
    expect(g.segmentFloors).toHaveLength(3);
    g.segmentFloors.forEach((f, i) => {
      expect(f).toBeLessThanOrEqual(g.optimum.outcome.segmentTimes[i]!);
      expect(Number.isFinite(f)).toBe(true);
    });
    const sum = g.segmentFloors.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(g.optimum.outcome.totalTime + 1e-9);
  });

  it('progress events are throttled to ≥ 50 ms apart and end at 1', () => {
    let clock = 0;
    const now = (): number => (clock += 7); // 7 ms per call
    const events: Array<{ t: number; f: number }> = [];
    gridSearch(STUB_A2, { now, onProgress: (f) => events.push({ t: clock, f }) });
    expect(events.at(-1)!.f).toBe(1);
    for (let i = 1; i < events.length - 1; i++) {
      expect(events[i]!.t - events[i - 1]!.t).toBeGreaterThanOrEqual(PROGRESS_INTERVAL_MS);
      expect(events[i]!.f).toBeGreaterThanOrEqual(events[i - 1]!.f);
    }
    expect(events.length).toBeGreaterThan(3);
  });

  it('is deterministic', () => {
    const a = gridSearch(SMALL3, { forceCoarse: true });
    const b = gridSearch(SMALL3, { forceCoarse: true });
    expect({ ...a, ms: 0 }).toEqual({ ...b, ms: 0 });
  });
});

describe('config hash', () => {
  it('is stable under key order and changes with sim-relevant fields only', () => {
    const reordered = JSON.parse(stableStringify(STUB_A2.track)) as LevelConfig['track'];
    expect(configHash({ ...STUB_A2, track: reordered })).toBe(configHash(STUB_A2));
    expect(configHash({ ...STUB_A2, title: 'Other', runBudget: 9 })).toBe(configHash(STUB_A2));
    expect(configHash({ ...STUB_A2, car: { mass: 760 } })).not.toBe(configHash(STUB_A2));
    expect(configHash({ ...STUB_A2, lockedLevers: { weight_dist: 0.47, wing: 4 } })).not.toBe(
      configHash(STUB_A2),
    );
    expect(configHash({ ...STUB_A2, tolerance: 0.02 })).not.toBe(configHash(STUB_A2));
    expect(gridKey(STUB_A2)).toMatch(/^A2:[0-9a-f]{14}$/);
  });
});
