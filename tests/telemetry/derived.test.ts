import { describe, expect, it } from 'vitest';
import type { PhysicalColumns } from '@/engine/types';
import { segmentStartIndices, segmentStartTimes } from '@/telemetry/derived';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { CORNER_TRACK, makeFixture } from './fixtures';

const pc = makeFixture({ segments: CORNER_TRACK });
const slower = makeFixture({ segments: CORNER_TRACK, rampTime: 1.4, vmax: 70 });

describe('segment helpers', () => {
  it('finds segment starts', () => {
    const idx = segmentStartIndices(pc);
    expect(idx).toHaveLength(3);
    expect(idx[0]).toBe(0);
    for (let k = 1; k < 3; k++) {
      expect(pc.seg[idx[k]!]).toBe(k);
      expect(pc.seg[idx[k]! - 1]).toBe(k - 1);
    }
    expect(segmentStartTimes(pc)[0]).toBe(0);
  });
});

describe('segment_time and segment_delta', () => {
  const floors = [9, 4, 9];
  const rt = createRunTelemetry({
    physical: pc,
    channelIds: ['segment_time', 'segment_delta'],
    seed: 1,
    segmentFloors: floors,
  });
  const starts = segmentStartIndices(pc);
  const startT = segmentStartTimes(pc);

  it('segment_time is 0 at each segment start and runs with t', () => {
    const st = rt.getClean('segment_time');
    for (const i of starts) expect(st[i]).toBe(0);
    expect(st[starts[1]! - 1]).toBeCloseTo(startT[1]! - pc.dt, 4);
  });

  it('segment_delta is 0 at every segment start', () => {
    const sd = rt.getClean('segment_delta');
    for (const i of starts) expect(sd[i]).toBe(0);
  });

  it('segment_delta reaches segmentTime − floor at each segment end', () => {
    const sd = rt.getClean('segment_delta');
    for (let k = 0; k < 3; k++) {
      const last = k < 2 ? starts[k + 1]! - 1 : pc.n - 1;
      const segTime = k < 2 ? startT[k + 1]! - startT[k]! : pc.t[pc.n - 1]! - startT[k]!;
      const expected = segTime - floors[k]!;
      // The last sample sits at most one step before the boundary: allow one step of time and of floor progress.
      const sStart = pc.s[starts[k]!]!;
      const sEnd = k < 2 ? pc.s[starts[k + 1]!]! : pc.s[pc.n - 1]!;
      const missing = 1 - (pc.s[last]! - sStart) / (sEnd - sStart);
      const tol = (k < 2 ? pc.dt : 0) + floors[k]! * missing + 1e-4;
      expect(Math.abs(sd[last]! - expected), `segment ${k}`).toBeLessThanOrEqual(tol);
    }
    // The final segment ends exactly at the last sample.
    expect(sd[pc.n - 1]).toBeCloseTo(pc.t[pc.n - 1]! - startT[2]! - floors[2]!, 4);
  });

  it('segment_delta is all NaN when the level has no floors', () => {
    const plain = createRunTelemetry({ physical: pc, channelIds: ['segment_delta'], seed: 1 });
    expect(plain.getClean('segment_delta').every(Number.isNaN)).toBe(true);
  });
});

describe('delta_best', () => {
  it('is 0 everywhere when the run equals the best', () => {
    const rt = createRunTelemetry({ physical: pc, channelIds: ['delta_best'], seed: 1, best: pc });
    for (const v of rt.getClean('delta_best')) expect(Math.abs(v)).toBeLessThan(1e-6);
    for (const v of rt.get('delta_best')) expect(Math.abs(v)).toBeLessThan(1e-6);
  });

  it('is 0 when there is no best run yet', () => {
    const rt = createRunTelemetry({ physical: pc, channelIds: ['delta_best'], seed: 1 });
    expect(rt.getClean('delta_best').every((v) => v === 0)).toBe(true);
  });

  it('grows positive for a slower run and ends at the total-time difference', () => {
    const rt = createRunTelemetry({
      physical: slower,
      channelIds: ['delta_best'],
      seed: 1,
      best: pc,
    });
    const d = rt.getClean('delta_best');
    const end = d[slower.n - 1]!;
    expect(end).toBeGreaterThan(0.2);
    expect(end).toBeCloseTo(slower.t[slower.n - 1]! - pc.t[pc.n - 1]!, 1);
    // Mid-run, it is the time difference at the same distance.
    const i = Math.floor(slower.n / 2);
    const s = slower.s[i]!;
    let j = 0;
    while (pc.s[j]! < s) j++;
    expect(d[i]).toBeCloseTo(slower.t[i]! - pc.t[j]!, 1);
  });

  it('is negative when this run is faster than the best', () => {
    const rt = createRunTelemetry({
      physical: pc,
      channelIds: ['delta_best'],
      seed: 1,
      best: slower,
    });
    expect(rt.getClean('delta_best')[pc.n - 1]).toBeLessThan(-0.2);
  });
});

describe('speed_diff and top_speed', () => {
  const rt = createRunTelemetry({
    physical: pc,
    channelIds: ['speed_diff_rl', 'speed_diff_rr', 'top_speed'],
    seed: 1,
  });

  it('speed_diff_rl/rr = wheel speed − ground speed', () => {
    const rl = rt.getClean('speed_diff_rl');
    const rr = rt.getClean('speed_diff_rr');
    for (let i = 0; i < pc.n; i += 37) {
      expect(rl[i]).toBeCloseTo(pc.ch.wheel_speed_rl![i]! - pc.ch.speed![i]!, 5);
      expect(rr[i]).toBeCloseTo(pc.ch.wheel_speed_rr![i]! - pc.ch.speed![i]!, 5);
    }
  });

  it('top_speed is the running maximum of speed', () => {
    const top = rt.getClean('top_speed');
    for (let i = 1; i < pc.n; i++) expect(top[i]!).toBeGreaterThanOrEqual(top[i - 1]!);
    expect(top[pc.n - 1]).toBe(Math.max(...pc.ch.speed!));
    // Noisy: still non-decreasing, skipping dropouts.
    const noisy = rt.get('top_speed');
    let prev = -Infinity;
    for (const v of noisy) {
      if (Number.isNaN(v)) continue;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('corner_min_speed and exit_speed', () => {
  const rt = createRunTelemetry({
    physical: pc,
    channelIds: ['corner_min_speed', 'exit_speed'],
    seed: 1,
  });
  const starts = segmentStartIndices(pc);
  const cornerFirst = starts[1]!;
  const cornerLast = starts[2]! - 1;

  for (const mode of ['clean', 'noisy'] as const) {
    it(`corner_min_speed is NaN on straights and a running minimum in the corner (${mode})`, () => {
      const v = mode === 'clean' ? rt.getClean('corner_min_speed') : rt.get('corner_min_speed');
      const speed = mode === 'clean' ? pc.ch.speed! : rt.get('speed');
      for (let i = 0; i < pc.n; i++) {
        if (pc.seg[i] !== 1) expect(Number.isNaN(v[i]!), `i=${i}`).toBe(true);
      }
      let min = Infinity;
      for (let i = cornerFirst; i <= cornerLast; i++) {
        if (!Number.isNaN(speed[i]!)) min = Math.min(min, speed[i]!);
        expect(v[i]).toBeCloseTo(min, 5);
      }
    });

    it(`exit_speed is NaN before the first corner exit, then holds the exit speed (${mode})`, () => {
      const v = mode === 'clean' ? rt.getClean('exit_speed') : rt.get('exit_speed');
      for (let i = 0; i < cornerLast; i++) expect(Number.isNaN(v[i]!)).toBe(true);
      const exit = v[cornerLast]!;
      expect(exit).toBeGreaterThan(25);
      if (mode === 'clean') expect(exit).toBe(pc.ch.speed![cornerLast]);
      for (let i = cornerLast; i < pc.n; i++) expect(v[i]).toBe(exit);
    });
  }

  it('a straight-only run has no corner values', () => {
    const flat: PhysicalColumns = makeFixture();
    const r = createRunTelemetry({
      physical: flat,
      channelIds: ['corner_min_speed', 'exit_speed'],
      seed: 2,
    });
    expect(r.get('corner_min_speed').every(Number.isNaN)).toBe(true);
    expect(r.get('exit_speed').every(Number.isNaN)).toBe(true);
  });
});
