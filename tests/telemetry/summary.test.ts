import { describe, expect, it } from 'vitest';
import type { ChannelId, PhysicalColumns } from '@/engine/types';
import { PHYSICAL_CHANNEL_IDS } from '@/telemetry/physical-defs';
import { allChannels } from '@/telemetry/registry';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { channelStats, summarize } from '@/telemetry/summary';
import type { RunTelemetry } from '@/telemetry/types';
import { CORNER_TRACK, makeFixture } from './fixtures';

/** A hand-made RunTelemetry over fixed arrays (no noise), for exact assertions. */
function fakeRt(cols: Record<ChannelId, number[]>, seg: number[]): RunTelemetry {
  const n = seg.length;
  const t = Float32Array.from({ length: n }, (_, i) => i * 0.5);
  const arrays = Object.fromEntries(
    Object.entries(cols).map(([k, v]) => [k, Float32Array.from(v)]),
  );
  return {
    n,
    dt: 0.5,
    t,
    s: Float32Array.from({ length: n }, (_, i) => i),
    seg: Uint8Array.from(seg),
    channelIds: Object.keys(cols),
    get: (id) => arrays[id]!,
    getClean: (id) => arrays[id]!,
  };
}

describe('channelStats', () => {
  it('computes min/max/mean with indices and times', () => {
    const s = channelStats(
      Float32Array.from([3, 1, NaN, 5, 1]),
      Float32Array.from([0, 1, 2, 3, 4]),
    );
    expect(s).toEqual({
      min: 1,
      max: 5,
      mean: 2.5,
      argmin: 1,
      argmax: 3,
      tMin: 1,
      tMax: 3,
      dropouts: 1,
    });
  });

  it('handles all-NaN and empty series without throwing', () => {
    const nan = channelStats(Float32Array.from([NaN, NaN]), Float32Array.from([0, 1]));
    expect(nan.argmin).toBe(-1);
    expect(nan.argmax).toBe(-1);
    expect(nan.mean).toBeNaN();
    expect(nan.min).toBeNaN();
    expect(nan.tMax).toBeNaN();
    expect(nan.dropouts).toBe(2);
    const empty = channelStats(new Float32Array(0), new Float32Array(0));
    expect(empty.mean).toBeNaN();
    expect(empty.dropouts).toBe(0);
  });
});

describe('summarize', () => {
  it('fills stats, clean and perSegment', () => {
    const rt = fakeRt(
      { speed: [0, 2, 4, 6, 3, 1], oil_temp: [NaN, NaN, NaN, NaN, NaN, NaN] },
      [0, 0, 0, 1, 1, 1],
    );
    const sum = summarize(rt);
    expect(sum.stats.speed).toMatchObject({ min: 0, max: 6, mean: 16 / 6, argmax: 3, tMax: 1.5 });
    expect(sum.clean.speed!.max).toBe(6);
    expect(sum.perSegment).toHaveLength(2);
    expect(sum.perSegment[0]!.speed).toMatchObject({ min: 0, max: 4, argmax: 2 });
    expect(sum.perSegment[1]!.speed).toMatchObject({ min: 1, max: 6, argmin: 5, argmax: 3 });
    expect(sum.stats.oil_temp!.mean).toBeNaN();
    expect(sum.stats.oil_temp!.dropouts).toBe(6);
  });

  it('window() gives the first and last time a predicate holds on the clean series', () => {
    const rt = fakeRt({ speed: [0, 2, 4, NaN, 6, 3, 1] }, [0, 0, 0, 0, 1, 1, 1]);
    const sum = summarize(rt);
    expect(sum.window('speed', (v) => v >= 3)).toEqual({ tStart: 1, tEnd: 2.5 });
    expect(sum.window('speed', (v) => v > 100)).toBeNull();
  });

  it('handles an empty run without throwing', () => {
    const empty: PhysicalColumns = {
      n: 0,
      dt: 0.01,
      t: new Float32Array(0),
      s: new Float32Array(0),
      seg: new Uint8Array(0),
      ch: Object.fromEntries(PHYSICAL_CHANNEL_IDS.map((id) => [id, new Float32Array(0)])),
    };
    const rt = createRunTelemetry({
      physical: empty,
      channelIds: allChannels().map((c) => c.id),
      seed: 1,
    });
    const sum = summarize(rt);
    expect(sum.stats.speed!.mean).toBeNaN();
    expect(sum.stats.oil_temp!.argmax).toBe(-1);
    expect(sum.perSegment).toEqual([]);
    expect(sum.window('speed', () => true)).toBeNull();
  });

  it('respects opts.ids and caches per run', () => {
    const pc = makeFixture({ segments: CORNER_TRACK });
    const rt = createRunTelemetry({
      physical: pc,
      channelIds: allChannels().map((c) => c.id),
      seed: 2,
    });
    const part = summarize(rt, { ids: ['speed', 'oil_temp'] });
    expect(Object.keys(part.stats)).toEqual(['speed', 'oil_temp']);
    expect(part.perSegment).toHaveLength(3);
    const again = summarize(rt);
    expect(again.stats.speed).toBe(part.stats.speed);
    expect(Object.keys(again.stats)).toHaveLength(rt.channelIds.length);
    // Noisy vs clean differ; per-segment maxima never exceed the run maximum.
    expect(again.stats.speed!.max).not.toBe(again.clean.speed!.max);
    for (const seg of again.perSegment)
      expect(seg.speed!.max).toBeLessThanOrEqual(again.stats.speed!.max);
  });

  it('summarizes 200+ channels × 6k samples in < 50 ms (×3 CI slack)', () => {
    const pc = makeFixture({
      segments: [
        { kind: 'straight', length: 1000 },
        { kind: 'straight', length: 1000 },
        { kind: 'straight', length: 1000 },
      ],
      vmax: 45,
    });
    expect(pc.n).toBeGreaterThanOrEqual(6000);
    const ids = allChannels().map((c) => c.id);
    expect(ids.length).toBeGreaterThanOrEqual(200);
    // Materialise first: the budget is for the summary itself (generation is lazy and separate).
    const rt = createRunTelemetry({ physical: pc, channelIds: ids, seed: 3 });
    for (const id of ids) {
      rt.get(id);
      rt.getClean(id);
    }
    // Warm the JIT on a different run so the timed call is not the first.
    const warm = createRunTelemetry({ physical: pc, channelIds: ids.slice(0, 40), seed: 4 });
    summarize(warm);
    const t0 = performance.now();
    summarize(rt);
    const ms = performance.now() - t0;
    if (process.env.SIGNAL_REPORT)
      console.log(`summarize ${ids.length} × ${pc.n}: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(150);
  });
});
