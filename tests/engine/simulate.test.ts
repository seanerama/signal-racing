/** simulate(): outcomes, columns, segments, stops, errors and determinism. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR } from '@/engine/car';
import { DT, MAX_TIME } from '@/engine/constants';
import { PHYSICAL_CHANNELS, SimDivergedError, simulate, trackGeometry } from '@/engine/index';
import { createRng } from '@/engine/rng';
import type { Track } from '@/engine/types';
import {
  FLAGS_A1,
  FLAGS_A2,
  PRESSURES,
  RAMPS,
  TRACK_A1,
  TRACK_A3,
  TRACK_A4,
  TRACK_B1,
  WEIGHT_DISTS,
  WINGS,
  input,
} from './fixtures';

const STOP_THEN_GO: Track = {
  id: 'stop-go',
  standingStart: true,
  laps: 1,
  segments: [
    { id: 'a', label: 'A', kind: 'straight', length: 300, endsWithStop: true },
    {
      id: 'b',
      label: 'B',
      kind: 'corner',
      length: 50 * (Math.PI / 2),
      radius: 50,
      direction: 'right',
    },
    { id: 'c', label: 'C', kind: 'straight', length: 200 },
  ],
};

function pick<T>(xs: readonly T[], r: () => number): T {
  return xs[Math.floor(r() * xs.length)] as T;
}

describe('outcome and columns', () => {
  it('records every physical channel at 100 Hz with matching lengths', () => {
    const r = simulate(input(TRACK_A4, FLAGS_A2), 'full');
    const c = r.columns!;
    expect(c.dt).toBe(DT);
    expect(c.n).toBeGreaterThan(1000);
    expect(c.t.length).toBe(c.n);
    expect(c.s.length).toBe(c.n);
    expect(c.seg.length).toBe(c.n);
    for (const meta of PHYSICAL_CHANNELS) {
      const col = c.ch[meta.id];
      expect(col, meta.id).toBeInstanceOf(Float32Array);
      expect(col!.length).toBe(c.n);
      expect(
        col!.every((x) => Number.isFinite(x)),
        meta.id,
      ).toBe(true);
    }
    expect(Object.keys(c.ch).length).toBe(PHYSICAL_CHANNELS.length);
    expect(c.t[1]! - c.t[0]!).toBeCloseTo(DT, 6);
    expect(Array.from(new Set(c.seg))).toEqual([0, 1, 2]);
  });

  it('channel metadata ids are unique snake_case', () => {
    const ids = PHYSICAL_CHANNELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('fast mode returns no columns', () => {
    expect(simulate(input(TRACK_A1, FLAGS_A2), 'fast').columns).toBeUndefined();
  });

  it('segment times sum to the total within 1e-9', () => {
    for (const track of [TRACK_A1, TRACK_A3, TRACK_A4, TRACK_B1, STOP_THEN_GO]) {
      const o = simulate(input(track, FLAGS_A2, { throttle_ramp: 0.2 }), 'fast').outcome;
      expect(o.finished).toBe(true);
      expect(o.segmentTimes.length).toBe(track.segments.length);
      const sum = o.segmentTimes.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - o.totalTime)).toBeLessThan(1e-9);
      expect(o.segmentTimes.every((x) => x > 0)).toBe(true);
    }
  });

  it('a stop segment that is not last stops, then relaunches from standstill', () => {
    const r = simulate(input(STOP_THEN_GO, FLAGS_A2, { throttle_ramp: 0.3 }), 'full');
    const c = r.columns!;
    const speed = c.ch.speed!;
    const firstB = c.seg.indexOf(1);
    expect(speed[firstB]).toBe(0);
    expect(Math.abs(c.s[firstB]! - 300)).toBeLessThan(1);
    // Throttle ramp restarts on relaunch.
    expect(c.ch.throttle![firstB]).toBe(0);
    expect(c.ch.throttle![firstB + 15]).toBeCloseTo(0.5, 5);
    expect(r.outcome.finished).toBe(true);
  });

  it('a rolling start begins at speed with full throttle', () => {
    const rolling: Track = { ...TRACK_A1, id: 'roll', standingStart: false };
    const r = simulate(input(rolling, FLAGS_A2, { throttle_ramp: 1 }), 'full');
    expect(r.columns!.ch.speed![0]).toBeGreaterThan(80);
    expect(r.columns!.ch.throttle![0]).toBe(1);
    const standing = simulate(input(TRACK_A1, FLAGS_A2), 'fast').outcome.totalTime;
    expect(r.outcome.totalTime).toBeLessThan(standing);
  });

  it('times out after 300 s as unfinished with an infinite total', () => {
    const x = input(TRACK_A1, FLAGS_A2);
    x.conditions.gripMultiplier = 0;
    const o = simulate(x, 'fast').outcome;
    expect(o.finished).toBe(false);
    expect(o.totalTime).toBe(Infinity);
    expect(o.segmentTimes).toEqual([Infinity]);
    expect(MAX_TIME).toBe(300);
  });

  it('reports top speed and corner channels', () => {
    const r = simulate(input(TRACK_B1, FLAGS_A2), 'full');
    const c = r.columns!;
    const maxSpeed = Math.max(...c.ch.speed!);
    expect(r.outcome.topSpeed).toBeGreaterThanOrEqual(maxSpeed - 1e-3);
    const mid = c.seg.indexOf(1) + 50;
    expect(c.ch.lat_g![mid]!).toBeLessThan(0); // right-hand corner
    expect(c.ch.steering_angle![mid]!).toBeCloseTo((-3.0 / 150) * (180 / Math.PI), 3);
    expect(c.ch.corner_limit_speed![mid]!).toBeGreaterThan(0);
    expect(c.ch.corner_limit_speed![0]).toBe(0);
    expect(c.ch.yaw_rate![mid]!).toBeCloseTo((-c.ch.speed![mid]! / 150) * (180 / Math.PI), 2);
  });

  it('wheel speeds diverge from ground speed under wheelspin and lock', () => {
    const spin = simulate(
      input(TRACK_A1, FLAGS_A2, { throttle_ramp: 0, tire_pressure: 1.2 }),
      'full',
    );
    const c = spin.columns!;
    const i = 50;
    expect(c.ch.rear_slip_ratio![i]!).toBeGreaterThan(0.1);
    expect(c.ch.wheel_speed_rl![i]!).toBeGreaterThan(c.ch.speed![i]!);
    expect(c.ch.wheel_speed_fl![i]).toBe(c.ch.speed![i]);
    const lock = simulate(input(TRACK_A3, FLAGS_A2, { weight_dist: 0.52 }), 'full').columns!;
    const j = lock.ch.front_slip_ratio!.findIndex((s, k) => s > 0.1 && lock.ch.brake![k] === 1);
    expect(j).toBeGreaterThan(0);
    expect(lock.ch.wheel_speed_fl![j]!).toBeLessThan(lock.ch.speed![j]!);
  });

  it('temperatures rise from ambient under load', () => {
    const c = simulate(input(TRACK_A3, FLAGS_A2), 'full').columns!;
    const last = c.n - 1;
    expect(c.ch.tire_temp_rl![last]!).toBeGreaterThan(c.ch.tire_temp_rl![0]!);
    expect(c.ch.brake_temp_front![last]!).toBeGreaterThan(c.ch.brake_temp_front![0]! + 1);
    expect(c.ch.brake_temp_front![last]!).toBeGreaterThan(c.ch.brake_temp_rear![last]!);
  });

  it('traction off: tire heat uses F/(μ_peak·N) and grip never limits', () => {
    const c = simulate(input(TRACK_A1, FLAGS_A1), 'full').columns!;
    expect(Math.max(...c.ch.rear_slip_ratio!)).toBe(0);
    expect(c.ch.tire_temp_rl![c.n - 1]!).toBeGreaterThan(c.ch.tire_temp_rl![0]!);
  });

  it('pos_x/pos_y/heading follow the top-down geometry', () => {
    const c = simulate(input(TRACK_A4, FLAGS_A2), 'full').columns!;
    expect(c.ch.pos_x![0]).toBe(0);
    expect(c.ch.pos_y![0]).toBe(0);
    expect(c.ch.heading![c.n - 1]!).toBeCloseTo(90, 1);
    const g = trackGeometry(TRACK_A4);
    expect(c.ch.pos_y![c.n - 1]!).toBeLessThanOrEqual(g.bounds.maxY + 1e-3);
  });
});

describe('braking envelope accuracy', () => {
  it('the A3 stop lands within ±1.0 m of 1000 m for 10 random valid setups', () => {
    const rng = createRng(20261008);
    for (let k = 0; k < 10; k++) {
      const setup = {
        throttle_ramp: pick(RAMPS, () => rng.next()),
        tire_pressure: pick(PRESSURES, () => rng.next()),
        weight_dist: pick(WEIGHT_DISTS, () => rng.next()),
        wing: pick(WINGS, () => rng.next()),
      };
      const r = simulate(input(TRACK_A3, FLAGS_A2, setup), 'full');
      const c = r.columns!;
      const sStop = c.s[c.n - 1]! + c.ch.speed![c.n - 1]! * DT;
      expect(Math.abs(sStop - 1000), JSON.stringify(setup)).toBeLessThanOrEqual(1.0);
      expect(r.outcome.finished).toBe(true);
    }
  });
});

describe('errors and determinism', () => {
  it('a forced NaN (mass 0) throws SimDivergedError, not garbage', () => {
    const x = input(TRACK_A1, FLAGS_A2);
    x.car = { ...DEFAULT_CAR, mass: 0 };
    let err: unknown;
    try {
      simulate(x, 'full');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SimDivergedError);
    const d = err as SimDivergedError;
    expect(d.name).toBe('SimDivergedError');
    expect(d.step).toBe(0);
    expect(d.state).toHaveProperty('v');
  });

  it('the same input gives bit-identical columns', () => {
    const a = simulate(input(TRACK_B1, FLAGS_A2, { throttle_ramp: 0.3 }), 'full');
    const b = simulate(input(TRACK_B1, FLAGS_A2, { throttle_ramp: 0.3 }), 'full');
    expect(b.outcome).toEqual(a.outcome);
    for (const id of Object.keys(a.columns!.ch)) {
      expect(
        Buffer.from(b.columns!.ch[id]!.buffer).equals(Buffer.from(a.columns!.ch[id]!.buffer)),
        id,
      ).toBe(true);
    }
  });

  it('the seed is accepted but does not change meeting-cut physics', () => {
    const x = input(TRACK_A4, FLAGS_A2);
    const y = { ...input(TRACK_A4, FLAGS_A2), seed: 987654321 };
    expect(simulate(y, 'fast').outcome).toEqual(simulate(x, 'fast').outcome);
  });

  it('does not mutate its input', () => {
    const x = input(TRACK_A4, FLAGS_A2);
    const before = JSON.stringify(x);
    simulate(x, 'full');
    expect(JSON.stringify(x)).toBe(before);
  });
});

describe('axle force channels (Stage 9, grip circle)', () => {
  it('√(fx² + fy²)/F_max equals grip_used per axle within 1e-6 at every sample', () => {
    for (const track of [TRACK_A1, TRACK_A3, TRACK_A4, TRACK_B1, STOP_THEN_GO]) {
      for (const setup of [
        { throttle_ramp: 0 },
        { throttle_ramp: 0.6, wing: 8, weight_dist: 0.38 },
        { tire_pressure: 2.2, wing: 0, weight_dist: 0.52 },
      ]) {
        const c = simulate(input(track, FLAGS_A2, setup), 'full').columns!;
        for (const axle of ['front', 'rear'] as const) {
          const fx = c.ch[`fx_${axle}`]!;
          const fy = c.ch[`fy_${axle}`]!;
          const budget = c.ch[`grip_budget_${axle}`]!;
          const used = c.ch[`grip_used_${axle}`]!;
          for (let i = 0; i < c.n; i++) {
            const r = Math.hypot(fx[i]!, fy[i]!) / budget[i]!;
            expect(Math.abs(r - used[i]!), `${track.id} ${axle} @${i}`).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it('signs: fx is + under drive and − under braking; fy is ≥ 0 and 0 on straights', () => {
    const c = simulate(input(TRACK_A4, FLAGS_A2), 'full').columns!;
    const brake = c.ch.brake!;
    const thr = c.ch.throttle!;
    for (let i = 0; i < c.n; i++) {
      if (brake[i]! > 0) expect(c.ch.fx_rear![i]!).toBeLessThanOrEqual(0);
      if (brake[i] === 0 && thr[i]! > 0) expect(c.ch.fx_rear![i]!).toBeGreaterThanOrEqual(0);
      expect(c.ch.fy_front![i]!).toBeGreaterThanOrEqual(0);
      if (c.seg[i] !== 1) expect(c.ch.fy_rear![i]!).toBe(0);
    }
  });
});
