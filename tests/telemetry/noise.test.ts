import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng';
import { applyNoise } from '@/telemetry/noise';
import { allChannels, channelQuantum, channelRange } from '@/telemetry/registry';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { makeFixture, std } from './fixtures';

describe('noise layer', () => {
  it('applyNoise: σ and dropout rate match the spec on a long series', () => {
    const n = 200_000;
    const clean = new Float32Array(n).fill(50);
    const out = applyNoise(
      clean,
      { sigmaFrac: 0.02, dropoutRate: 0.002, range: [0, 100] },
      createRng(1),
    );
    const drops = out.filter(Number.isNaN).length;
    expect(drops / n).toBeGreaterThan(0.002 * 0.85);
    expect(drops / n).toBeLessThan(0.002 * 1.15);
    expect(std(out)).toBeGreaterThan(2 * 0.98);
    expect(std(out)).toBeLessThan(2 * 1.02);
    expect(clean[0]).toBe(50); // input untouched
  });

  it('applyNoise: zero spec is an exact copy; NaN input stays NaN; quantum re-quantises', () => {
    const clean = Float32Array.from([1, 2, NaN, 4]);
    const copy = applyNoise(clean, { sigmaFrac: 0, dropoutRate: 0, range: [0, 10] }, createRng(1));
    expect(copy).not.toBe(clean);
    expect([...copy]).toEqual([...clean]);
    const noisy = applyNoise(
      clean,
      { sigmaFrac: 0.01, dropoutRate: 0, range: [0, 10] },
      createRng(1),
    );
    expect(Number.isNaN(noisy[2]!)).toBe(true);
    const q = applyNoise(
      clean,
      { sigmaFrac: 0.01, dropoutRate: 0, range: [0, 10], quantum: 1 },
      createRng(1),
    );
    for (const v of q) if (!Number.isNaN(v)) expect(Number.isInteger(v)).toBe(true);
  });

  it('every analogue channel: measured σ / range is within ±20% of sigmaFrac', () => {
    // A long run (≈ 7k samples) so each σ estimate is good to a few percent.
    const pc = makeFixture({
      segments: [
        { kind: 'straight', length: 1000 },
        { kind: 'straight', length: 1000 },
        { kind: 'straight', length: 1000 },
      ],
      vmax: 45,
    });
    expect(pc.n).toBeGreaterThan(6000);
    const ids = allChannels().map((c) => c.id);
    const rt = createRunTelemetry({ physical: pc, channelIds: ids, seed: 77 });
    let checked = 0;
    for (const c of allChannels()) {
      if (c.noise.sigmaFrac === 0 || channelQuantum(c.id) !== undefined) continue;
      const clean = rt.getClean(c.id);
      const noisy = rt.get(c.id);
      const diff = new Float32Array(rt.n);
      for (let i = 0; i < rt.n; i++) diff[i] = noisy[i]! - clean[i]!;
      const [lo, hi] = channelRange(c.id);
      // Float32 storage limits resolution on large-offset channels; that is far below 20%.
      const measured = std(diff) / (hi - lo);
      expect(measured / c.noise.sigmaFrac, c.id).toBeGreaterThan(0.8);
      expect(measured / c.noise.sigmaFrac, c.id).toBeLessThan(1.2);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('dropout rate across the registry matches the declared rates', () => {
    const pc = makeFixture({ vmax: 45, segments: [{ kind: 'straight', length: 2000 }] });
    const rt = createRunTelemetry({ physical: pc, channelIds: [], seed: 5 });
    let expected = 0;
    let observed = 0;
    for (const c of allChannels()) {
      if (c.source.kind === 'derived') continue;
      expected += c.noise.dropoutRate * rt.n;
      observed += rt.get(c.id).filter(Number.isNaN).length;
    }
    expect(observed / expected).toBeGreaterThan(0.85);
    expect(observed / expected).toBeLessThan(1.15);
  });
});
