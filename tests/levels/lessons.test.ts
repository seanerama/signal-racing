/**
 * Stage 11: the lessons the Fable spirit review found weak, held as tests.
 *
 * - A2 (finding 3): pressure is single-peaked on the lever grid, every step near the peak moves
 *   the time by ≥ 0.1 %, the grid optimum is the Model page's p_opt, and following any fired
 *   hint one step never makes the next run slower.
 * - A3 (finding 2): at most 3 of 8 weights pass at otherwise optimal settings (and at the default
 *   ramp and pressure); at the optimum neither axle slides, as the debrief says; the rears no
 *   longer lock in every stop.
 * - A4 (finding 1): only the wing is free, the locked levers are A3's grid optimum, and the wing
 *   alone reaches the target.
 * - B1L / B4L (findings 1, 4, 5): weight rules both ways and the generic headroom rule.
 * - Hints never go silent off target (finding 5): `silence.slow.test.ts` (`npm run test:slow`).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR, simulate } from '@/engine/index';
import type { Setup } from '@/engine/types';
import { A2, A3, A4, B1L, B4L } from '@/levels/index';
import { SLIP_LIMIT } from '@/levels/common';
import { A3_ANSWER } from '@/levels/a4-corner';
import type { LevelConfig } from '@/levels/types';
import { buildBaseSimInput } from '@/worker/build-input';
import { gridFor } from './hint-bot';
import { oneStepViolations } from './one-step';

const T = { timeout: 120_000 };
const time = (level: LevelConfig, s: Partial<Setup>): number =>
  simulate(buildBaseSimInput(level, s), 'fast').outcome.totalTime;
const steps = (min: number, max: number, step: number): number[] =>
  Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => +(min + i * step).toFixed(3),
  );

describe('A2: pressure is a real lever', () => {
  const pressures = steps(1.2, 2.2, 0.1);
  const ramps = steps(0, 3, 0.2);
  /** Best time at each pressure over every ramp (the lever's profile). */
  const profile = (): number[] =>
    pressures.map((p) =>
      Math.min(...ramps.map((r) => time(A2, { throttle_ramp: r, tire_pressure: p }))),
    );

  it('single-peaked on the lever grid, ≥ 0.1 % per step on both sides of the peak', T, () => {
    const t = profile();
    const peak = t.indexOf(Math.min(...t));
    console.log(
      'A2 pressure profile: ' + pressures.map((p, i) => `${p}→${t[i]!.toFixed(3)}`).join(' '),
    );
    for (let i = 1; i <= peak; i++) expect(t[i - 1]! / t[i]! - 1).toBeGreaterThanOrEqual(0.001);
    for (let i = peak + 1; i < t.length; i++)
      expect(t[i]! / t[i - 1]! - 1).toBeGreaterThanOrEqual(0.001);
  });

  it('the grid optimum names the Model page p_opt, on the lever grid', () => {
    expect(gridFor(A2).optimum.setup.tire_pressure).toBeCloseTo(DEFAULT_CAR.pOpt, 9);
    expect(pressures.some((p) => Math.abs(p - DEFAULT_CAR.pOpt) < 1e-9)).toBe(true);
  });

  it('following any fired hint one step never makes the next run slower', T, () => {
    const v = oneStepViolations(A2, gridFor(A2));
    expect(v.map((x) => `${JSON.stringify(x.setup)} ${x.rule} ${x.from} → ${x.to}`)).toEqual([]);
  });
});

describe('A3: the weight tradeoff decides the pass', () => {
  const weights = steps(0.38, 0.52, 0.02);
  const passCount = (base: Partial<Setup>): number => {
    const g = gridFor(A3);
    return weights.filter((wd) => time(A3, { ...base, weight_dist: wd }) <= g.target).length;
  };

  it('at most 3 of 8 weights pass at otherwise optimal settings, and at the defaults', T, () => {
    const opt = gridFor(A3).optimum.setup;
    const atOpt = passCount({ throttle_ramp: opt.throttle_ramp, tire_pressure: opt.tire_pressure });
    const defaults = Object.fromEntries(A3.levers.map((l) => [l.id, l.default]));
    const atDefaults = passCount(defaults);
    console.log(
      `A3 weights passing: ${atOpt}/8 at the optimum's ramp/pressure, ${atDefaults}/8 at the defaults`,
    );
    expect(atOpt).toBeLessThanOrEqual(3);
    expect(atDefaults).toBeLessThanOrEqual(3);
    expect(atOpt).toBeGreaterThanOrEqual(1);
  });

  it('at the optimum neither axle slides, launch or stop (the debrief sentence)', T, () => {
    const c = simulate(buildBaseSimInput(A3, gridFor(A3).optimum.setup), 'full').columns!;
    const max = (id: string): number => Math.max(...c.ch[id]!);
    expect(max('front_slip_ratio')).toBeLessThanOrEqual(SLIP_LIMIT + 1e-3);
    expect(max('rear_slip_ratio')).toBeLessThanOrEqual(SLIP_LIMIT + 1e-3);
  });

  it(
    'the rears lock in the stop only with too little rear weight, and the fronts with too much',
    T,
    () => {
      const opt = gridFor(A3).optimum.setup;
      const lockedIn = (wd: number, id: string): boolean => {
        const c = simulate(buildBaseSimInput(A3, { ...opt, weight_dist: wd }), 'full').columns!;
        for (let i = 0; i < c.t.length; i++)
          if (c.ch.brake![i]! > 0.01 && c.ch[id]![i]! > SLIP_LIMIT + 1e-3) return true;
        return false;
      };
      expect(lockedIn(0.4, 'rear_slip_ratio')).toBe(true);
      expect(lockedIn(opt.weight_dist, 'rear_slip_ratio')).toBe(false);
      expect(lockedIn(opt.weight_dist, 'front_slip_ratio')).toBe(false);
      expect(lockedIn(0.5, 'front_slip_ratio')).toBe(true);
      expect(lockedIn(0.5, 'rear_slip_ratio')).toBe(false);
    },
  );
});

describe('A4: one concept, one lever', () => {
  it('only the wing is unlocked; the rest is locked at A3’s grid optimum', T, () => {
    expect(A4.levers.map((l) => l.id)).toEqual(['wing']);
    const a3 = gridFor(A3).optimum.setup;
    expect(A3_ANSWER).toEqual({
      throttle_ramp: a3.throttle_ramp,
      tire_pressure: a3.tire_pressure,
      weight_dist: a3.weight_dist,
    });
    expect(A4.lockedLevers).toEqual(A3_ANSWER);
  });

  it('the wing alone reaches the target, with an optimum of at least 5', T, () => {
    const g = gridFor(A4);
    expect(g.optimum.setup.wing).toBeGreaterThanOrEqual(5);
    const passing = steps(0, 8, 1).filter((w) => time(A4, { wing: w }) <= g.target);
    expect(passing.length).toBeGreaterThan(0);
    expect(passing).not.toContain(A4.levers[0]!.default);
  });
});

describe('B1L and B4L: weight rules both ways, and the headroom rule', () => {
  it.each([
    ['B1L', B1L, ['launch_spin', 'front_lock', 'setup_headroom']],
    ['B4L', B4L, ['launch_spin', 'front_lock', 'rear_lock', 'transfer_headroom', 'setup_headroom']],
  ] as const)('%s', (_id, level, ids) => {
    const have = level.hintRules.map((r) => r.id);
    for (const id of ids) expect(have).toContain(id);
    expect(level.levers.map((l) => l.id).sort()).toEqual(
      ['throttle_ramp', 'tire_pressure', 'weight_dist', 'wing'].sort(),
    );
  });
});
