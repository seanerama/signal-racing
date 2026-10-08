/**
 * Contract 02 behavioural guarantees 1–10. The lessons must fall out of the model: these tests
 * search the lever grids (as the game's target search will) and assert where the optimum lies.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAR } from '@/engine/car';
import { G } from '@/engine/constants';
import { cornerLimitSpeed, simulate } from '@/engine/index';
import { aeroCoeffs, rollingForce } from '@/engine/physics';
import { poseAt, trackGeometry, trackLayout } from '@/engine/track';
import type { ModelFlags, Setup, Track } from '@/engine/types';
import {
  BASE_SETUP,
  CONDITIONS,
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

const car = DEFAULT_CAR;

// Grid searches run hundreds of sims; coverage instrumentation slows them several-fold.
vi.setConfig({ testTimeout: 60_000 });

function time(track: Track, flags: ModelFlags, setup: Partial<Setup>): number {
  return simulate(input(track, flags, setup), 'fast').outcome.totalTime;
}

/** Index of the strict minimum (first one on ties). */
function argmin(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if ((xs[i] ?? Infinity) < (xs[best] ?? Infinity)) best = i;
  return best;
}

function bestRamp(track: Track, s: Partial<Setup>): { ramp: number; t: number } {
  const ts = RAMPS.map((r) => time(track, FLAGS_A2, { ...s, throttle_ramp: r }));
  const i = argmin(ts);
  return { ramp: RAMPS[i]!, t: ts[i]! };
}

describe('guarantee 1: A1, traction off', () => {
  it('total time is monotone non-decreasing in throttle_ramp, so the optimum is 0', () => {
    const ts = RAMPS.map((r) => time(TRACK_A1, FLAGS_A1, { throttle_ramp: r }));
    for (let i = 1; i < ts.length; i++) expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
    expect(argmin(ts)).toBe(0);
  });
});

describe('guarantee 2: A2, traction and pressure on', () => {
  it('the time-optimal ramp is strictly inside (0, 3.0) at p = pOpt', () => {
    const ts = RAMPS.map((r) =>
      time(TRACK_A1, FLAGS_A2, { throttle_ramp: r, tire_pressure: car.pOpt }),
    );
    const i = argmin(ts);
    expect(RAMPS[i]!).toBeGreaterThan(0);
    expect(RAMPS[i]!).toBeLessThan(3.0);
    // The lever teaches something: ≥ 1% spread across the range.
    expect((Math.max(...ts) - ts[i]!) / ts[i]!).toBeGreaterThan(0.01);
    // Ramp 0 spins the rears past the slip peak; the optimum does not.
    const spin = simulate(input(TRACK_A1, FLAGS_A2, { throttle_ramp: 0 }), 'full').columns!;
    const ok = simulate(input(TRACK_A1, FLAGS_A2, { throttle_ramp: RAMPS[i]! }), 'full').columns!;
    expect(Math.max(...spin.ch.rear_slip_ratio!)).toBeGreaterThan(0.1);
    expect(Math.max(...ok.ch.rear_slip_ratio!)).toBeLessThanOrEqual(0.1);
  });

  it('robustness: the ramp optimum stays interior with ≥ 1% spread for fPeak 5.5–6.1 kN', () => {
    for (const fPeak of [5500, 5600, 5700, 5800, 5900, 6000, 6100]) {
      const ts = RAMPS.map(
        (r) =>
          simulate(
            {
              ...input(TRACK_A1, FLAGS_A2, { throttle_ramp: r, tire_pressure: car.pOpt }),
              car: { ...car, fPeak },
            },
            'fast',
          ).outcome.totalTime,
      );
      const i = argmin(ts);
      expect(RAMPS[i]!, `fPeak ${fPeak}`).toBeGreaterThan(0);
      expect(RAMPS[i]!, `fPeak ${fPeak}`).toBeLessThan(3.0);
      expect((Math.max(...ts) - ts[i]!) / ts[i]!, `fPeak ${fPeak}`).toBeGreaterThan(0.01);
    }
  });

  it('the time-optimal pressure (ramp optimised per pressure) lies inside the lever range', () => {
    const ts = PRESSURES.map((p) => bestRamp(TRACK_A1, { tire_pressure: p }).t);
    const i = argmin(ts);
    // Once the tires out-grip the engine, more grip buys nothing: the optimum is a plateau of
    // pressures near pOpt that all avoid wheelspin. It must sit inside the range and hold pOpt.
    const best = PRESSURES.filter((_, j) => ts[j]! <= ts[i]! + 1e-9);
    expect(best[0]!).toBeGreaterThan(PRESSURES[0]!);
    expect(best[best.length - 1]!).toBeLessThan(PRESSURES[PRESSURES.length - 1]!);
    expect(best.some((p) => Math.abs(p - car.pOpt) <= 0.05 + 1e-9)).toBe(true);
    expect((Math.max(...ts) - ts[i]!) / ts[i]!).toBeGreaterThan(0.005);
  });
});

describe('guarantee 3: A3, launch and stop at 1000 m', () => {
  it('the time-optimal weight_dist lies strictly inside [0.38, 0.52]', () => {
    const ts = WEIGHT_DISTS.map(
      (d) => bestRamp(TRACK_A3, { weight_dist: d, tire_pressure: car.pOpt }).t,
    );
    const i = argmin(ts);
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(WEIGHT_DISTS.length - 1);
    expect((Math.max(...ts) - ts[i]!) / ts[i]!).toBeGreaterThan(0.005);
  });

  it('at weight_dist = 0.52 the fronts lock under braking: max(front_slip_ratio) > 0.10', () => {
    const { ramp } = bestRamp(TRACK_A3, { weight_dist: 0.52 });
    const c = simulate(
      input(TRACK_A3, FLAGS_A2, { weight_dist: 0.52, throttle_ramp: ramp }),
      'full',
    ).columns!;
    let maxBraking = 0;
    for (let i = 0; i < c.n; i++) {
      if (c.ch.brake![i] === 1) maxBraking = Math.max(maxBraking, c.ch.front_slip_ratio![i]!);
    }
    expect(maxBraking).toBeGreaterThan(0.1);
  });
});

describe('guarantee 4: power-limited top speed', () => {
  const long: Track = {
    id: 'long',
    standingStart: true,
    laps: 1,
    segments: [{ id: 'l', label: 'Long', kind: 'straight', length: 12_000 }],
  };

  it('matches P = ½ρCdA·v³ + crr·m·g·v within 0.5%', () => {
    // Wings 0–4 top out above P/fPeak, i.e. in the power-limited regime.
    for (const wing of [0, 2, 4]) {
      const top = simulate(input(long, FLAGS_A2, { wing }), 'fast').outcome.topSpeed;
      expect(top).toBeGreaterThan(car.power / car.fPeak);
      const { cdA } = aeroCoeffs(car, wing);
      const p = 0.5 * 1.225 * cdA * top ** 3 + rollingForce(car) * top;
      expect(Math.abs(p - car.power) / car.power).toBeLessThan(0.005);
    }
  });

  it('below P/fPeak the top speed is force-limited: fPeak = drag + rolling', () => {
    const top = simulate(input(long, FLAGS_A2, { wing: 8 }), 'fast').outcome.topSpeed;
    expect(top).toBeLessThan(car.power / car.fPeak);
    const { cdA } = aeroCoeffs(car, 8);
    const f = 0.5 * 1.225 * cdA * top ** 2 + rollingForce(car);
    expect(Math.abs(f - car.fPeak) / car.fPeak).toBeLessThan(0.005);
  });
});

describe('guarantee 5: load conservation', () => {
  it('Σ N_i = m·g + F_down at every step within 1e-6 relative', () => {
    for (const track of [TRACK_A3, TRACK_A4]) {
      const c = simulate(input(track, FLAGS_A2), 'full').columns!;
      for (let i = 0; i < c.n; i++) {
        const sum = c.ch.load_fl![i]! + c.ch.load_fr![i]! + c.ch.load_rl![i]! + c.ch.load_rr![i]!;
        const expected = car.mass * G + c.ch.downforce![i]!;
        expect(Math.abs(sum - expected) / expected).toBeLessThan(1e-6);
      }
    }
  });
});

describe('guarantee 6: fast and full agree', () => {
  it('simulate(x, fast).outcome deep-equals simulate(x, full).outcome', () => {
    const cases: [Track, ModelFlags, Partial<Setup>][] = [
      [TRACK_A1, FLAGS_A1, { throttle_ramp: 0.7 }],
      [TRACK_A1, FLAGS_A2, { throttle_ramp: 0.2, tire_pressure: 1.3 }],
      [TRACK_A3, FLAGS_A2, { weight_dist: 0.4, wing: 2 }],
      [TRACK_A4, FLAGS_A2, { wing: 7 }],
      [TRACK_B1, FLAGS_A2, { wing: 1, weight_dist: 0.5 }],
    ];
    for (const [track, flags, setup] of cases) {
      const fast = simulate(input(track, flags, setup), 'fast');
      const full = simulate(input(track, flags, setup), 'full');
      expect(fast.outcome).toStrictEqual(full.outcome);
    }
  });
});

describe('guarantee 7: the aero compromise', () => {
  function bestWing(track: Track): { wing: number; times: number[] } {
    const times = WINGS.map((w) => {
      let best = Infinity;
      for (const r of [0, 0.2, 0.4]) {
        for (const d of WEIGHT_DISTS)
          best = Math.min(
            best,
            time(track, FLAGS_A2, { wing: w, throttle_ramp: r, weight_dist: d }),
          );
      }
      return best;
    });
    return { wing: WINGS[argmin(times)]!, times };
  }

  it('A4: the time-optimal wing is ≥ 5; B1-lite: strictly lower than A4 (the B1 surprise)', () => {
    const a4 = bestWing(TRACK_A4);
    const b1 = bestWing(TRACK_B1);
    expect(a4.wing).toBeGreaterThanOrEqual(5);
    expect(b1.wing).toBeLessThan(a4.wing);
    expect(b1.wing).toBeGreaterThan(0); // the corner still pays for some wing
  });
});

describe('guarantee 8: corner hold', () => {
  it('hold speed equals cornerLimitSpeed within 0.5% and grip used mid-corner is in [0.97, 1.0]', () => {
    for (const [track, wing] of [
      [TRACK_A4, 0],
      [TRACK_A4, 4],
      [TRACK_A4, 8],
      [TRACK_B1, 2],
      [TRACK_B1, 6],
    ] as const) {
      const setup = { ...BASE_SETUP, wing };
      const c = simulate(input(track, FLAGS_A2, setup), 'full').columns!;
      const seg = track.segments[1]!;
      const vLim = cornerLimitSpeed(car, setup, CONDITIONS, FLAGS_A2, seg.radius!);
      const idx = [...c.seg.keys()].filter((i) => c.seg[i] === 1);
      // The middle half of the corner.
      const mid = idx.slice(Math.floor(idx.length / 4), Math.ceil((3 * idx.length) / 4));
      expect(mid.length).toBeGreaterThan(50);
      for (const i of mid) {
        expect(Math.abs(c.ch.speed![i]! - vLim) / vLim).toBeLessThan(0.005);
        const used = Math.max(c.ch.grip_used_front![i]!, c.ch.grip_used_rear![i]!);
        expect(used).toBeGreaterThanOrEqual(0.97);
        expect(used).toBeLessThanOrEqual(1.0 + 1e-6);
      }
    }
  });
});

describe('guarantee 9: track geometry', () => {
  it('a 90° corner turns the heading by 90° ± 0.1°', () => {
    const layout = trackLayout(TRACK_A4);
    const h = (poseAt(layout, layout.ends[1]!).heading * 180) / Math.PI;
    expect(Math.abs(h - 90)).toBeLessThan(0.1);
  });

  it('pos_x/pos_y at each sample lie on the geometry polyline within 0.05 m', () => {
    for (const track of [TRACK_A4, TRACK_B1]) {
      const g = trackGeometry(track);
      const p = g.points;
      const nPts = p.length / 2;
      const c = simulate(input(track, FLAGS_A2), 'full').columns!;
      for (let i = 0; i < c.n; i++) {
        const x = c.ch.pos_x![i]!;
        const y = c.ch.pos_y![i]!;
        const k = Math.min(nPts - 2, Math.max(0, Math.floor(c.s[i]!)));
        let best = Infinity;
        for (let j = Math.max(0, k - 1); j <= Math.min(nPts - 2, k + 1); j++) {
          const ax = p[2 * j]!;
          const ay = p[2 * j + 1]!;
          const bx = p[2 * j + 2]!;
          const by = p[2 * j + 3]!;
          const dx = bx - ax;
          const dy = by - ay;
          const len2 = dx * dx + dy * dy;
          const u = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
          best = Math.min(best, Math.hypot(x - (ax + u * dx), y - (ay + u * dy)));
        }
        expect(best).toBeLessThan(0.05);
      }
    }
  });
});

describe('guarantee 10: performance', () => {
  it('a 1 km segment in full mode runs in < 30 ms (3× slack: 90 ms)', () => {
    const x = input(TRACK_A3, FLAGS_A2);
    for (let i = 0; i < 5; i++) simulate(x, 'full'); // warm up the JIT
    const samples: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      simulate(x, 'full');
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    expect(samples[3]!).toBeLessThan(90);
  });
});
