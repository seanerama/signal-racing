import { describe, expect, it } from 'vitest';
import { STUB_A2 } from '../game/stub-level';
import type { LevelConfig } from '@/levels/types';
import {
  buildBaseSimInput,
  buildSimInput,
  effectiveSetup,
  runConditions,
  runSeed,
} from '@/worker/build-input';

const VARIED: LevelConfig = {
  ...STUB_A2,
  conditions: {
    base: { trackTemp: 30, ambientTemp: 20, gripMultiplier: 1 },
    variation: { gripFrac: 0.01, trackTempC: 3 },
  },
};

describe('build-input', () => {
  it('seed is per run: hash(levelId, runIndex), uint32, deterministic', () => {
    const seeds = Array.from({ length: 50 }, (_, i) => runSeed('A2', i + 1));
    expect(new Set(seeds).size).toBe(50);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
    expect(runSeed('A2', 3)).toBe(seeds[2]);
    expect(runSeed('A3', 3)).not.toBe(runSeed('A2', 3));
    // Even without variation, the run seed changes every run (telemetry noise differs).
    expect(buildSimInput(STUB_A2, {}, 1).seed).not.toBe(buildSimInput(STUB_A2, {}, 2).seed);
  });

  it('condition variation is deterministic per (levelId, runIndex) and within ±gripFrac / ±trackTempC', () => {
    const a = buildSimInput(VARIED, {}, 4).conditions;
    const b = buildSimInput(VARIED, {}, 4).conditions;
    expect(a).toEqual(b);
    const grips = new Set<number>();
    for (let i = 1; i <= 200; i++) {
      const c = buildSimInput(VARIED, {}, i).conditions;
      expect(Math.abs(c.gripMultiplier - 1)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(c.trackTemp - 30)).toBeLessThanOrEqual(3);
      expect(c.ambientTemp).toBe(20);
      grips.add(c.gripMultiplier);
    }
    expect(grips.size).toBeGreaterThan(150);
    // Same run index on another level → different draw.
    expect(buildSimInput({ ...VARIED, id: 'A3' }, {}, 4).conditions).not.toEqual(a);
  });

  it('variation is absent when the level declares none', () => {
    for (let i = 1; i <= 20; i++) {
      expect(buildSimInput(STUB_A2, {}, i).conditions).toEqual(STUB_A2.conditions.base);
    }
    expect(runConditions(STUB_A2, 12345)).toEqual(STUB_A2.conditions.base);
  });

  it('locked levers override the player setup; lever defaults fill gaps', () => {
    const s = effectiveSetup(STUB_A2, { throttle_ramp: 0.4, wing: 7 });
    expect(s).toEqual({ throttle_ramp: 0.4, tire_pressure: 1.9, weight_dist: 0.45, wing: 4 });
  });

  it('grid search input: base conditions and a fixed seed', () => {
    const a = buildBaseSimInput(VARIED, {});
    const b = buildBaseSimInput(VARIED, { throttle_ramp: 1 });
    expect(a.conditions).toEqual(VARIED.conditions.base);
    expect(a.seed).toBe(b.seed);
    expect(a.seed).toBe(runSeed('A2', 0));
  });
});
