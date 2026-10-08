/** Corner rows 18–22 and the grip assembly. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR } from '@/engine/car';
import { G } from '@/engine/constants';
import {
  computeGrip,
  cornerLimitSpeed,
  createGripContext,
  createGripState,
  frictionCircle,
  gripUsed,
  lateralDemand,
  lateralTransfer,
} from '@/engine/corner';
import { BASE_SETUP, CONDITIONS, FLAGS_A1, FLAGS_A2 } from './fixtures';

const car = DEFAULT_CAR;

describe('row 18–19: lateral demand and transfer', () => {
  it('a_y = v²/r split by moment balance', () => {
    const d = lateralDemand(750, 0.45, 20, 80);
    expect(d.front).toBeCloseTo(750 * 5 * 0.55, 9);
    expect(d.rear).toBeCloseTo(750 * 5 * 0.45, 9);
    expect(lateralDemand(750, 0.45, 20, Infinity).front).toBe(0);
  });
  it('ΔN_lat = m·a_y·h/t split q : 1−q', () => {
    const t = lateralTransfer(car, 750, 5, 0.5);
    const dN = (750 * 5 * 0.3) / 1.9;
    expect(t.front).toBeCloseTo(dN / 2, 9);
    expect(t.rear).toBeCloseTo(dN / 2, 9);
    expect(lateralTransfer(car, 750, 5, 0.7).front).toBeCloseTo(0.7 * dN, 9);
  });
});

describe('row 20, 22: friction circle and grip used', () => {
  it('longitudinal force left is √(F_max² − F_y²)', () => {
    expect(frictionCircle(1000, 600)).toBeCloseTo(800, 9);
    expect(frictionCircle(1000, 1200)).toBe(0);
    expect(frictionCircle(Infinity, 1200)).toBe(Infinity);
  });
  it('grip used is √(F_x² + F_y²)/F_max', () => {
    expect(gripUsed(300, 400, 1000)).toBeCloseTo(0.5, 12);
    expect(gripUsed(0, 0, 0)).toBe(0);
    expect(gripUsed(1, 0, 0)).toBe(Infinity);
  });
});

describe('computeGrip', () => {
  const ctx = createGripContext(car, BASE_SETUP, CONDITIONS, FLAGS_A2);

  it('conserves load: Σ N_i = m·g + F_down, in a corner and under acceleration', () => {
    const g = computeGrip(ctx, 40, 3, 1 / 80, null, createGripState());
    const sum = g.nFL + g.nFR + g.nRL + g.nRR;
    expect(sum).toBeCloseTo(750 * G + g.fDown, 6);
  });
  it('a left corner loads the right (outside) tires, a right corner the left', () => {
    const left = computeGrip(ctx, 30, 0, 1 / 80, null, createGripState());
    expect(left.nFR).toBeGreaterThan(left.nFL);
    expect(left.nRR).toBeGreaterThan(left.nRL);
    const right = computeGrip(ctx, 30, 0, -1 / 80, null, createGripState());
    expect(right.nFL).toBeCloseTo(left.nFR, 9);
    expect(right.nRL).toBeCloseTo(left.nRR, 9);
  });
  it('lateral transfer lowers the axle budget (load sensitivity)', () => {
    const straight = computeGrip(ctx, 30, 0, 0, null, createGripState());
    const corner = computeGrip(ctx, 30, 0, 1 / 80, null, createGripState());
    expect(corner.budgetFront).toBeLessThan(straight.budgetFront);
    expect(corner.budgetRear).toBeLessThan(straight.budgetRear);
  });
  it('the inside tire load is clamped at zero without breaking conservation', () => {
    const g = computeGrip(ctx, 80, 0, 1 / 10, null, createGripState());
    expect(Math.min(g.nFL, g.nRL)).toBeGreaterThanOrEqual(0);
    expect(g.nFL + g.nFR + g.nRL + g.nRR).toBeCloseTo(750 * G + g.fDown, 6);
  });
  it('budgets are infinite (but still reported) with the traction limit off', () => {
    const off = createGripContext(car, BASE_SETUP, CONDITIONS, FLAGS_A1);
    const g = computeGrip(off, 30, 0, 0, null, createGripState());
    expect(g.fMaxRear).toBe(Infinity);
    expect(g.fxMaxRear).toBe(Infinity);
    expect(Number.isFinite(g.budgetRear)).toBe(true);
  });
  it('tire temperature changes μ only when tempAffectsGrip is on', () => {
    const hot = [140, 140, 140, 140];
    const flagsOn = { ...FLAGS_A2, tempAffectsGrip: true };
    const on = createGripContext(car, BASE_SETUP, CONDITIONS, flagsOn);
    const cool = computeGrip(on, 30, 0, 0, null, createGripState());
    const cooked = computeGrip(on, 30, 0, 0, hot, createGripState());
    expect(cooked.budgetRear).toBeLessThan(cool.budgetRear);
    const off = computeGrip(ctx, 30, 0, 0, hot, createGripState());
    expect(off.budgetRear).toBeCloseTo(
      computeGrip(ctx, 30, 0, 0, null, createGripState()).budgetRear,
      9,
    );
  });
});

describe('row 21: cornerLimitSpeed', () => {
  const feasible = (v: number, wing = 4): boolean => {
    const ctx = createGripContext(car, { ...BASE_SETUP, wing }, CONDITIONS, FLAGS_A2);
    const g = computeGrip(ctx, v, 0, 1 / 80, null, createGripState());
    return g.fyFront <= g.fMaxFront && g.fyRear <= g.fMaxRear;
  };

  it('is the largest feasible speed to within 0.01 m/s', () => {
    const v = cornerLimitSpeed(car, BASE_SETUP, CONDITIONS, FLAGS_A2, 80);
    expect(feasible(v)).toBe(true);
    expect(feasible(v + 0.011)).toBe(false);
    // Sanity: between the no-downforce estimate √(μ g r) and twice it.
    expect(v).toBeGreaterThan(Math.sqrt(1.5 * G * 80));
    expect(v).toBeLessThan(2 * Math.sqrt(1.6 * G * 80));
  });
  it('rises with wing (downforce) and radius, falls with grip', () => {
    const v4 = cornerLimitSpeed(car, BASE_SETUP, CONDITIONS, FLAGS_A2, 80);
    const v8 = cornerLimitSpeed(car, { ...BASE_SETUP, wing: 8 }, CONDITIONS, FLAGS_A2, 80);
    const vR = cornerLimitSpeed(car, BASE_SETUP, CONDITIONS, FLAGS_A2, 150);
    const vWet = cornerLimitSpeed(
      car,
      BASE_SETUP,
      { ...CONDITIONS, gripMultiplier: 0.5 },
      FLAGS_A2,
      80,
    );
    expect(v8).toBeGreaterThan(v4);
    expect(vR).toBeGreaterThan(v4);
    expect(vWet).toBeLessThan(v4);
  });
  it('is unbounded (200 m/s bracket) when grip never limits', () => {
    expect(cornerLimitSpeed(car, BASE_SETUP, CONDITIONS, FLAGS_A1, 80)).toBe(200);
  });
});
