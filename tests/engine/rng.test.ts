import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '@/engine/rng';

function take(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.next());
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

describe('rng: determinism', () => {
  it('same seed → identical sequence', () => {
    expect(take(createRng(42), 1000)).toEqual(take(createRng(42), 1000));
  });

  it('different seeds → different sequences', () => {
    expect(take(createRng(1), 10)).not.toEqual(take(createRng(2), 10));
  });

  it('same seed and fork labels → identical sequences, independent of parent position', () => {
    const a = createRng(7);
    const b = createRng(7);
    take(b, 500); // advancing the parent must not change its forks
    expect(take(a.fork('noise:speed'), 200)).toEqual(take(b.fork('noise:speed'), 200));
    expect(take(a.fork('x').fork('y'), 50)).toEqual(take(b.fork('x').fork('y'), 50));
  });

  it('normal() is deterministic too', () => {
    const a = createRng(99);
    const b = createRng(99);
    for (let i = 0; i < 101; i++) expect(a.normal()).toBe(b.normal());
  });

  it('values lie in [0, 1)', () => {
    const rng = createRng(123);
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe('rng: fork independence', () => {
  it('first 1k values of two forks have |corr| < 0.1', () => {
    const root = createRng(2026);
    const labels = ['noise:speed', 'noise:long_g', 'distractor:oil_temp', 'distractor:oil_tem'];
    const streams = labels.map((l) => take(root.fork(l), 1000));
    for (let i = 0; i < streams.length; i++) {
      for (let j = i + 1; j < streams.length; j++) {
        expect(Math.abs(pearson(streams[i]!, streams[j]!))).toBeLessThan(0.1);
      }
    }
    // A fork is also independent of its parent.
    expect(Math.abs(pearson(take(createRng(2026), 1000), streams[0]!))).toBeLessThan(0.1);
  });

  it('a fork differs from its parent and siblings', () => {
    const root = createRng(5);
    expect(take(root.fork('a'), 5)).not.toEqual(take(root.fork('b'), 5));
    expect(take(createRng(5).fork('a'), 5)).not.toEqual(take(createRng(5), 5));
  });
});

describe('rng: distribution', () => {
  it('next() mean ≈ 0.5 over 1e5 samples', () => {
    const rng = createRng(11);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) sum += rng.next();
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it('normal() mean ≈ 0 and σ ≈ 1 over 1e5 samples', () => {
    const rng = createRng(31337);
    const n = 100_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      expect(Number.isFinite(v)).toBe(true);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
  });
});
