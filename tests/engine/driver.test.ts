/** The driver: braking envelope and per-step pedal decisions. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR } from '@/engine/car';
import { ENVELOPE_DS, V_UNBOUNDED } from '@/engine/constants';
import { createGripContext } from '@/engine/corner';
import {
  BRAKE_LATCH,
  brakingDecel,
  brakingEnvelope,
  driverInputs,
  envelopeAt,
  type DriverState,
  type Envelope,
} from '@/engine/driver';
import { cornerLimitSpeed } from '@/engine/index';
import { BASE_SETUP, CONDITIONS, FLAGS_A2, TRACK_A1, TRACK_A3, TRACK_A4 } from './fixtures';

const car = DEFAULT_CAR;

describe('brakingEnvelope', () => {
  it('is unbounded everywhere on a plain straight', () => {
    const env = brakingEnvelope(TRACK_A1, car, BASE_SETUP, CONDITIONS, FLAGS_A2);
    expect(env.length).toBe(1000 / ENVELOPE_DS + 1);
    expect(env.every((v) => v >= V_UNBOUNDED)).toBe(true);
  });

  it('falls to 0 at a stop point and grows backwards from it', () => {
    const env = brakingEnvelope(TRACK_A3, car, BASE_SETUP, CONDITIONS, FLAGS_A2);
    expect(env[env.length - 1]).toBe(0);
    // Strictly rising backwards until it exceeds anything the car can reach (then unbounded).
    let k = env.length - 2;
    for (; env[k]! < V_UNBOUNDED; k--) expect(env[k]!).toBeGreaterThan(env[k + 1]!);
    expect(env[k + 1]!).toBeGreaterThan(90);
    // ~1.3–1.8 g of braking: ~30 m/s needs roughly 25–40 m.
    const k30 = env.findIndex((v) => v < 30);
    const dist = 1000 - k30 * ENVELOPE_DS;
    expect(dist).toBeGreaterThan(20);
    expect(dist).toBeLessThan(45);
    expect(env[0]).toBe(V_UNBOUNDED);
  });

  it('holds the corner limit speed across the corner', () => {
    const env = brakingEnvelope(TRACK_A4, car, BASE_SETUP, CONDITIONS, FLAGS_A2);
    const vLim = cornerLimitSpeed(car, BASE_SETUP, CONDITIONS, FLAGS_A2, 80);
    const mid = Math.round(260 / ENVELOPE_DS);
    expect(env[mid]).toBeCloseTo(vLim, 3);
    expect(env[Math.round(200 / ENVELOPE_DS)]).toBeCloseTo(vLim, 3);
    expect(env[Math.round(190 / ENVELOPE_DS)]!).toBeGreaterThan(vLim);
    // After the corner the envelope is unbounded again.
    expect(env[Math.round(340 / ENVELOPE_DS)]).toBe(V_UNBOUNDED);
  });

  it('braking deceleration includes downforce (more at speed)', () => {
    const ctx = createGripContext(car, BASE_SETUP, CONDITIONS, FLAGS_A2);
    const slow = brakingDecel(ctx, 10, 0);
    const fast = brakingDecel(ctx, 80, 0);
    expect(slow).toBeGreaterThan(9);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('envelopeAt', () => {
  const env: Envelope = { v: new Float32Array([10, 0]), ds: 1, total: 1, stopAtEnd: true };
  it('interpolates in v² (exact for constant deceleration)', () => {
    expect(envelopeAt(env, 0.5)).toBeCloseTo(Math.sqrt(50), 5);
    expect(envelopeAt(env, -1)).toBe(10);
    expect(envelopeAt(env, 2)).toBe(0);
  });
  it('beyond the end of a non-stop track it uses the last value', () => {
    expect(envelopeAt({ ...env, stopAtEnd: false, v: new Float32Array([5, 7]) }, 3)).toBe(7);
  });
  it('treats a step to or from unbounded as unbounded', () => {
    const e: Envelope = {
      v: new Float32Array([V_UNBOUNDED, 30]),
      ds: 1,
      total: 1,
      stopAtEnd: false,
    };
    expect(envelopeAt(e, 0.5)).toBe(V_UNBOUNDED);
  });
});

describe('driverInputs', () => {
  const env: Envelope = { v: new Float32Array([50, 50, 50]), ds: 1, total: 2, stopAtEnd: false };
  const base: DriverState = {
    s: 0.5,
    v: 20,
    tSinceLaunch: 0.25,
    ramp: 0.5,
    braking: false,
    vLim: Infinity,
    stopAt: Infinity,
    mass: 750,
    engineFull: 6000,
    resistance: 300,
    fxMaxRear: 5000,
    rearSliding: false,
  };

  it('follows the ramp below the envelope', () => {
    expect(driverInputs(base, env)).toEqual({ throttle: 0.5, brake: 0 });
  });
  it('brakes at full pedal at or above the envelope, with a latch', () => {
    expect(driverInputs({ ...base, v: 50 }, env)).toEqual({ throttle: 0, brake: 1 });
    expect(driverInputs({ ...base, v: 50 - BRAKE_LATCH / 2, braking: true }, env).brake).toBe(1);
    expect(driverInputs({ ...base, v: 50 - 2 * BRAKE_LATCH, braking: true }, env).brake).toBe(0);
  });
  it('past or braking for a stop point stays on the pedal until stopped', () => {
    expect(driverInputs({ ...base, stopAt: 0.4 }, env).brake).toBe(1);
    expect(driverInputs({ ...base, stopAt: 2, v: 1, braking: true }, env).brake).toBe(1);
    expect(driverInputs({ ...base, stopAt: 0.4, v: 0 }, env).brake).toBe(0);
  });
  it('in a corner holds v_lim with throttle that cancels resistance, capped by the friction circle', () => {
    const hold = driverInputs({ ...base, v: 30, vLim: 30, tSinceLaunch: 10 }, env);
    expect(hold.brake).toBe(0);
    expect(hold.throttle).toBeCloseTo(300 / 6000, 12);
    const capped = driverInputs({ ...base, v: 30, vLim: 30, tSinceLaunch: 10, fxMaxRear: 60 }, env);
    expect(capped.throttle).toBeCloseTo(60 / 6000, 12);
    // Slightly fast in the corner: lift rather than brake.
    const fast = driverInputs({ ...base, v: 30.1, vLim: 30, tSinceLaunch: 10 }, env);
    expect(fast).toEqual({ throttle: 0, brake: 0 });
  });
  it('the friction-circle cap is inclusive: θ·F_full never rounds above F_x,max (Stage 9)', () => {
    // From the B4L latch: (cap/5800)·5800 rounds one ulp above cap, a demand ratio of 1 + 2⁻⁵².
    const cap = 1614.7911725938977;
    expect((cap / 5800) * 5800).toBeGreaterThan(cap);
    const s = { ...base, v: 30, vLim: 30, tSinceLaunch: 10, engineFull: 5800, resistance: 9000 };
    const out = driverInputs({ ...s, fxMaxRear: cap }, env);
    expect(out.throttle * 5800).toBeLessThanOrEqual(cap);
    expect(out.throttle * 5800).toBeGreaterThan(cap * (1 - 1e-12));
  });
  it('lifts for one step when the rear arrives sliding in a corner (row 12b)', () => {
    const s = { ...base, v: 30, vLim: 30, tSinceLaunch: 10 };
    expect(driverInputs({ ...s, rearSliding: true }, env)).toEqual({ throttle: 0, brake: 0 });
    // On a straight, wheelspin is the player's ramp: the driver does not lift.
    expect(driverInputs({ ...base, rearSliding: true }, env).throttle).toBe(0.5);
  });
});
