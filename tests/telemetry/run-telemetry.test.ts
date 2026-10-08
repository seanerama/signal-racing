import { describe, expect, it } from 'vitest';
import type { PhysicalColumns } from '@/engine/types';
import { PHYSICAL_CHANNEL_IDS } from '@/telemetry/physical-defs';
import { allChannels, registryIndex } from '@/telemetry/registry';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { CORNER_TRACK, makeFixture } from './fixtures';

const ALL_IDS = allChannels().map((c) => c.id);
const pc = makeFixture({ segments: CORNER_TRACK });

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

describe('createRunTelemetry', () => {
  it('exposes the run axes and the channel set in registry order', () => {
    const rt = createRunTelemetry({
      physical: pc,
      channelIds: ['oil_temp', 'speed', 'delta_best'],
      seed: 1,
    });
    expect(rt.n).toBe(pc.n);
    expect(rt.dt).toBe(pc.dt);
    expect(rt.t).toBe(pc.t);
    expect(rt.s).toBe(pc.s);
    expect(rt.seg).toBe(pc.seg);
    expect(rt.channelIds).toEqual(['speed', 'delta_best', 'oil_temp']);
  });

  it('throws on an unknown channel id', () => {
    expect(() =>
      createRunTelemetry({ physical: pc, channelIds: ['warp_drive'], seed: 1 }),
    ).toThrow();
    const rt = createRunTelemetry({ physical: pc, channelIds: ['speed'], seed: 1 });
    expect(() => rt.get('warp_drive')).toThrow(/unknown channel/);
  });

  it('get() and getClean() are deterministic across instances with the same seed', () => {
    const a = createRunTelemetry({ physical: pc, channelIds: ALL_IDS, seed: 42 });
    const b = createRunTelemetry({ physical: pc, channelIds: ALL_IDS, seed: 42 });
    // Read b in reverse order: the result must not depend on access order.
    const bNoisy = new Map([...ALL_IDS].reverse().map((id) => [id, b.get(id)]));
    for (const id of ALL_IDS) {
      expect(sameBits(a.get(id), bNoisy.get(id)!), id).toBe(true);
      expect(sameBits(a.getClean(id), b.getClean(id)), id).toBe(true);
    }
  });

  it('caches: repeated reads return the same array', () => {
    const rt = createRunTelemetry({ physical: pc, channelIds: ALL_IDS, seed: 3 });
    expect(rt.get('oil_temp')).toBe(rt.get('oil_temp'));
    expect(rt.getClean('oil_temp')).toBe(rt.getClean('oil_temp'));
    expect(rt.get('speed')).not.toBe(rt.getClean('speed'));
    expect(rt.getClean('speed')).toBe(pc.ch.speed);
  });

  it('different seeds change noise and distractors but never the clean physical values', () => {
    const a = createRunTelemetry({ physical: pc, channelIds: ALL_IDS, seed: 1 });
    const b = createRunTelemetry({ physical: pc, channelIds: ALL_IDS, seed: 2 });
    for (const id of PHYSICAL_CHANNEL_IDS) {
      expect(sameBits(a.getClean(id), b.getClean(id)), id).toBe(true);
      if (['pos_x', 'pos_y', 'heading'].includes(id)) continue;
      expect(sameBits(a.get(id), b.get(id)), id).toBe(false);
    }
    expect(sameBits(a.getClean('oil_temp'), b.getClean('oil_temp'))).toBe(false);
    expect(sameBits(a.get('battery_voltage'), b.get('battery_voltage'))).toBe(false);
    // Timing math channels depend only on t/s/seg.
    expect(sameBits(a.get('segment_time'), b.get('segment_time'))).toBe(true);
  });

  it('pos_x, pos_y and heading are exact in the noisy series', () => {
    const rt = createRunTelemetry({ physical: pc, channelIds: ALL_IDS, seed: 9 });
    for (const id of ['pos_x', 'pos_y', 'heading']) {
      expect(sameBits(rt.get(id), pc.ch[id]!), id).toBe(true);
    }
  });

  it('noisy series has NaN dropouts; clean series has none', () => {
    const rt = createRunTelemetry({ physical: pc, channelIds: ALL_IDS, seed: 11 });
    let noisyNaN = 0;
    for (const id of ALL_IDS) {
      noisyNaN += rt.get(id).filter(Number.isNaN).length;
      if (['corner_min_speed', 'exit_speed', 'segment_delta'].includes(id)) continue; // NaN by definition
      expect(rt.getClean(id).some(Number.isNaN), id).toBe(false);
    }
    expect(noisyNaN).toBeGreaterThan(0);
  });

  it('noisy math channels are computed from the noisy inputs', () => {
    const rt = createRunTelemetry({ physical: pc, channelIds: ['speed_diff_rl'], seed: 5 });
    const diff = rt.get('speed_diff_rl');
    const wheel = rt.get('wheel_speed_rl');
    const speed = rt.get('speed');
    for (let i = 0; i < rt.n; i += 97) {
      if (Number.isNaN(diff[i]!))
        expect(Number.isNaN(wheel[i]!) || Number.isNaN(speed[i]!)).toBe(true);
      else expect(diff[i]).toBeCloseTo(wheel[i]! - speed[i]!, 4);
    }
  });

  it('is lazy: nothing is generated until asked, and get() on a distractor touches only that channel', () => {
    // A run whose physical columns would throw if anything beyond t/s/seg/throttle/speed were read.
    const trap: PhysicalColumns = {
      ...pc,
      ch: new Proxy(pc.ch, {
        get(target, key: string) {
          if (key !== 'throttle' && key !== 'speed') throw new Error(`read ${key}`);
          return target[key];
        },
      }),
    };
    const rt = createRunTelemetry({ physical: trap, channelIds: ALL_IDS, seed: 1 });
    expect(() => rt.get('oil_temp')).not.toThrow();
    expect(() => rt.get('pitot_dp_3')).not.toThrow();
    expect(() => rt.get('load_fl')).toThrow(/read load_fl/);
  });

  it('a physical channel missing from the columns throws a clear error', () => {
    const partial: PhysicalColumns = { ...pc, ch: { speed: pc.ch.speed! } };
    const rt = createRunTelemetry({ physical: partial, channelIds: ['speed', 'lat_g'], seed: 1 });
    expect(() => rt.get('lat_g')).toThrow(/missing/);
    expect(registryIndex('speed')).toBe(0);
  });
});
