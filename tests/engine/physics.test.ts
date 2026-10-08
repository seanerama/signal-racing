/** Unit tests for each contract 02 row function, at hand-computed points. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR } from '@/engine/car';
import { G } from '@/engine/constants';
import {
  aeroCoeffs,
  axleBudget,
  brakeDemand,
  brakeTempRate,
  carMass,
  downforce,
  dragForce,
  engineForce,
  gearRpm,
  powerLimitedTopSpeed,
  topSpeed,
  pressureFactor,
  rollingForce,
  staticLoads,
  tempFactor,
  throttle,
  tireForce,
  tireMu,
  tireTempRate,
  transferLoads,
} from '@/engine/physics';
import { FLAGS_A1, FLAGS_A2 } from './fixtures';

const car = DEFAULT_CAR;
const ALL_ON = { tractionLimit: true, pressureAffectsGrip: true, tempAffectsGrip: true };

describe('row 1–2: aero', () => {
  it('CdA = 1.0 and ClA = 3.0 at w = 4', () => {
    const a = aeroCoeffs(car, 4);
    expect(a.cdA).toBeCloseTo(1.0, 12);
    expect(a.clA).toBeCloseTo(3.0, 12);
  });
  it('drag at 50 m/s with w = 4 is 1531.25 N', () => {
    expect(dragForce(aeroCoeffs(car, 4).cdA, 50)).toBeCloseTo(1531.25, 9);
  });
  it('downforce at 50 m/s with w = 4 is 4593.75 N', () => {
    expect(downforce(aeroCoeffs(car, 4).clA, 50)).toBeCloseTo(4593.75, 9);
  });
  it('wing raises lift linearly and drag quadratically', () => {
    const a0 = aeroCoeffs(car, 0);
    const a8 = aeroCoeffs(car, 8);
    expect(a8.clA - a0.clA).toBeCloseTo(8 * car.klA, 12);
    expect(a8.cdA - a0.cdA).toBeCloseTo(64 * car.kdA, 12);
  });
});

describe('row 3–4: loads', () => {
  it('static loads split weight by d and downforce by b', () => {
    const l = staticLoads(car, 0.45, 1000);
    expect(l.front).toBeCloseTo(0.55 * 750 * G + 0.45 * 1000, 9);
    expect(l.rear).toBeCloseTo(0.45 * 750 * G + 0.55 * 1000, 9);
  });
  it('longitudinal transfer ΔN = m·a·h/L moves load rearward under acceleration', () => {
    const l = transferLoads(car, 4000, 3000, 2);
    expect(l.front).toBeCloseTo(3850, 9);
    expect(l.rear).toBeCloseTo(3150, 9);
  });
  it('transfer is clamped so no axle goes negative and the total is conserved', () => {
    const acc = transferLoads(car, 4000, 3000, 100);
    expect(acc.front).toBe(0);
    expect(acc.rear).toBe(7000);
    const brake = transferLoads(car, 4000, 3000, -100);
    expect(brake.rear).toBe(0);
    expect(brake.front).toBe(7000);
  });
  it('rolling resistance is crr·m·g', () => {
    expect(rollingForce(car)).toBeCloseTo(0.015 * 750 * G, 9);
    expect(carMass({ ...car, fuelMass0: 10 })).toBe(760);
  });
});

describe('row 5–8: grip', () => {
  it('pressure factor is a bell around pOpt, and 1 when switched off', () => {
    expect(pressureFactor(car, car.pOpt, FLAGS_A2)).toBe(1);
    expect(pressureFactor(car, car.pOpt + car.sigmaP, FLAGS_A2)).toBeCloseTo(Math.exp(-1), 12);
    expect(pressureFactor(car, 1.2, FLAGS_A1)).toBe(1);
  });
  it('temperature factor is a bell around tOpt, and 1 when switched off', () => {
    expect(tempFactor(car, car.tOpt, ALL_ON)).toBe(1);
    expect(tempFactor(car, car.tOpt - car.sigmaT, ALL_ON)).toBeCloseTo(Math.exp(-1), 12);
    expect(tempFactor(car, 20, FLAGS_A2)).toBe(1);
  });
  it('load sensitivity: μ falls 10% per 100% load above N_ref', () => {
    const nRef = (750 * G) / 4;
    expect(tireMu(car, 1.6, nRef)).toBeCloseTo(1.6, 12);
    expect(tireMu(car, 1.6, 2 * nRef)).toBeCloseTo(1.44, 12);
    expect(tireMu(car, 1.6, 0)).toBeCloseTo(1.76, 12);
  });
  it('moving load across an axle lowers that axle’s budget', () => {
    const nRef = (750 * G) / 4;
    const even = 2 * tireMu(car, 1.6, nRef) * nRef;
    const moved =
      tireMu(car, 1.6, nRef + 500) * (nRef + 500) + tireMu(car, 1.6, nRef - 500) * (nRef - 500);
    expect(moved).toBeLessThan(even);
  });
  it('axle budget is Σ μ_i·N_i, infinite with the traction limit off', () => {
    expect(axleBudget(1.5, 2000, 1.6, 1000, FLAGS_A2)).toBeCloseTo(4600, 9);
    expect(axleBudget(1.5, 2000, 1.6, 1000, FLAGS_A1)).toBe(Infinity);
  });
});

describe('row 9–12: driver forces and tires', () => {
  it('throttle ramps linearly, is instant at 0, and is 0 while braking', () => {
    expect(throttle(0.5, 1, false)).toBe(0.5);
    expect(throttle(2, 1, false)).toBe(1);
    expect(throttle(0, 0, false)).toBe(1);
    expect(throttle(0.5, 1, true)).toBe(0);
    expect(throttle(-1, 1, false)).toBe(0);
  });
  it('engine force is torque-limited low and power-limited high', () => {
    expect(engineForce(car, 1, 10)).toBe(car.fPeak);
    expect(engineForce(car, 1, 100)).toBeCloseTo(car.power / 100, 9);
    expect(engineForce(car, 0.5, 100)).toBeCloseTo((0.5 * car.power) / 100, 9);
    expect(engineForce({ ...car, fPeak: 1e9 }, 1, 0)).toBeCloseTo(car.power / 0.5, 9);
  });
  it('brake demand splits by the front bias at full pedal', () => {
    const b = brakeDemand(car, 1);
    expect(b.front).toBeCloseTo(car.brakeBiasFront * car.brakeForceMax, 9);
    expect(b.rear).toBeCloseTo((1 - car.brakeBiasFront) * car.brakeForceMax, 9);
    expect(b.front + b.rear).toBeCloseTo(car.brakeForceMax, 9);
    expect(brakeDemand(car, 0).front).toBe(0);
  });
  it('tire force: within budget delivers demand with slip = sPeak·r', () => {
    const f = tireForce(car, 500, 1000);
    expect(f.force).toBe(500);
    expect(f.slip).toBeCloseTo(0.05, 12);
    expect(f.sliding).toBe(false);
  });
  it('tire force: over budget slides at slideFactor·F_max with growing slip', () => {
    const f = tireForce(car, 2000, 1000);
    expect(f.force).toBeCloseTo(800, 12);
    // Row 12b: slip = min(1, sPeak + kSlide·max(0, r − kRegrip)) = 0.1 + 0.5·(2 − 0.85).
    expect(f.slip).toBeCloseTo(0.675, 12);
    expect(f.sliding).toBe(true);
    expect(tireForce(car, 5000, 1000).slip).toBe(1);
    expect(tireForce(car, 100, 0)).toEqual({ force: 0, slip: 1, sliding: true });
    expect(tireForce(car, 100, Infinity)).toEqual({ force: 100, slip: 0, sliding: false });
    expect(tireForce(car, 0, 1000)).toEqual({ force: 0, slip: 0, sliding: false });
  });
  it('row 12b hysteresis: a slide started at r = 1.05 persists at r = 0.9 and ends at r = 0.84', () => {
    expect(car.kRegrip).toBe(0.85);
    const start = tireForce(car, 1050, 1000, undefined, false);
    expect(start.sliding).toBe(true);
    expect(start.force).toBeCloseTo(car.slideFactor * 1000, 12);
    // Without a prior slide r = 0.9 grips; after one it keeps sliding.
    expect(tireForce(car, 900, 1000, undefined, false).sliding).toBe(false);
    const held = tireForce(car, 900, 1000, undefined, start.sliding);
    expect(held.sliding).toBe(true);
    expect(held.force).toBeCloseTo(car.slideFactor * 1000, 12);
    expect(held.slip).toBeCloseTo(car.sPeak + car.kSlide * (0.9 - car.kRegrip), 12);
    const regrip = tireForce(car, 840, 1000, undefined, held.sliding);
    expect(regrip.sliding).toBe(false);
    expect(regrip.force).toBe(840);
    expect(regrip.slip).toBeCloseTo(car.sPeak * 0.84, 12);
    // No demand ends a slide.
    expect(tireForce(car, 0, 1000, undefined, true).sliding).toBe(false);
  });
});

describe('row 15–17: temperatures and gears', () => {
  it('tire heating is kHeat·ratio²·v, ×2 when sliding, minus cooling', () => {
    expect(tireTempRate(30, 0.5, 20, false, 30)).toBeCloseTo(0.25, 12);
    expect(tireTempRate(30, 0.5, 20, true, 30)).toBeCloseTo(0.5, 12);
    expect(tireTempRate(50, 0, 20, false, 30)).toBeCloseTo(-0.4, 12);
  });
  it('brake heating is kBrake·F·v minus cooling', () => {
    expect(brakeTempRate(20, 1000, 10, 20)).toBeCloseTo(0.02, 12);
    expect(brakeTempRate(120, 0, 10, 20)).toBeCloseTo(-5, 12);
  });
  it('gear and rpm form a sawtooth over 15 m/s bands', () => {
    expect(gearRpm(0)).toEqual({ gear: 1, rpm: 4000 });
    expect(gearRpm(15)).toEqual({ gear: 2, rpm: 4000 });
    expect(gearRpm(22.5).rpm).toBeCloseTo(8000, 9);
    const top = gearRpm(100);
    expect(top.gear).toBe(6);
    expect(top.rpm).toBeCloseTo(4000 + (25 / 15) * 8000, 9);
  });
  it('power-limited top speed solves P = ½ρCdA·v³ + crr·m·g·v', () => {
    const v = powerLimitedTopSpeed(car, 4);
    const p = dragForce(1.0, v) * v + rollingForce(car) * v;
    expect(p).toBeCloseTo(car.power, 3);
  });
  it('full-throttle top speed is power-limited at low wing and force-limited at high wing', () => {
    expect(topSpeed(car, 4)).toBeCloseTo(powerLimitedTopSpeed(car, 4), 6);
    const v8 = topSpeed(car, 8);
    expect(v8).toBeLessThan(powerLimitedTopSpeed(car, 8));
    expect(dragForce(aeroCoeffs(car, 8).cdA, v8) + rollingForce(car)).toBeCloseTo(car.fPeak, 3);
  });
});
