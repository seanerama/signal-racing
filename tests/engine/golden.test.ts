/**
 * Bit-identity guard for engine performance work (Stage 5). The outcomes and a hash of every
 * full-mode column for a fixed set of setups were recorded from the Stage 2 engine *before* any
 * optimisation (`golden-outcomes.json`). Any engine change must reproduce them exactly: the
 * comparison is `Object.is` on every number, not a tolerance.
 *
 * Regenerate only for an intentional physics change: `UPDATE_GOLDEN=1 npx vitest run tests/engine/golden`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSimCache, simulate } from '@/engine/index';
import type { ModelFlags, Outcome, PhysicalColumns, Setup, Track } from '@/engine/types';
import {
  FLAGS_A1,
  FLAGS_A2,
  TRACK_A1,
  TRACK_A3,
  TRACK_A4,
  TRACK_B1,
  TRACK_B4,
  input,
} from './fixtures';

vi.setConfig({ testTimeout: 120_000 });

const GOLDEN_PATH = new URL('./golden-outcomes.json', import.meta.url);

const TRACKS: Record<string, Track> = {
  a1: TRACK_A1,
  a3: TRACK_A3,
  a4: TRACK_A4,
  b1: TRACK_B1,
  b4: TRACK_B4,
};
const FLAGS: Record<string, ModelFlags> = { a1: FLAGS_A1, a2: FLAGS_A2 };

/** Spans the lever ranges: corners, middles and off-centre points. */
const SETUPS: Setup[] = [
  { throttle_ramp: 0, tire_pressure: 1.65, weight_dist: 0.45, wing: 4 },
  { throttle_ramp: 0.5, tire_pressure: 1.65, weight_dist: 0.45, wing: 4 },
  { throttle_ramp: 1.5, tire_pressure: 2.2, weight_dist: 0.52, wing: 8 },
  { throttle_ramp: 0.3, tire_pressure: 1.2, weight_dist: 0.38, wing: 0 },
  { throttle_ramp: 0.7, tire_pressure: 1.9, weight_dist: 0.4, wing: 2 },
  { throttle_ramp: 0.9, tire_pressure: 1.4, weight_dist: 0.5, wing: 6 },
  { throttle_ramp: 0.2, tire_pressure: 1.7, weight_dist: 0.48, wing: 7 },
  { throttle_ramp: 1.1, tire_pressure: 1.5, weight_dist: 0.42, wing: 1 },
];

interface Golden {
  key: string;
  outcome: Outcome;
  /** FNV-1a over the bytes of t, s, seg and every channel (sorted by id); full mode only. */
  columnsHash?: string;
}

function hashColumns(c: PhysicalColumns): string {
  let h = 0x811c9dc5;
  const feed = (a: ArrayBufferView): void => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ (b[i] ?? 0), 0x01000193) >>> 0;
  };
  feed(c.t);
  feed(c.s);
  feed(c.seg);
  for (const id of Object.keys(c.ch).sort()) feed(c.ch[id]!);
  return `${c.n}:${h.toString(16)}`;
}

function cases(): Array<{ key: string; track: Track; flags: ModelFlags; setup: Setup }> {
  const out: Array<{ key: string; track: Track; flags: ModelFlags; setup: Setup }> = [];
  for (const [tk, track] of Object.entries(TRACKS)) {
    for (const [fk, flags] of Object.entries(FLAGS)) {
      SETUPS.forEach((setup, i) => out.push({ key: `${tk}/${fk}/${i}`, track, flags, setup }));
    }
  }
  return out;
}

function compute(useCache: boolean): Golden[] {
  const cache = useCache ? createSimCache() : undefined;
  return cases().map(({ key, track, flags, setup }, i) => {
    const inp = input(track, flags, setup);
    // Full mode for every third case keeps the file small but still covers the columns.
    if (i % 3 === 0) {
      const r = simulate(inp, 'full', cache);
      return { key, outcome: r.outcome, columnsHash: hashColumns(r.columns!) };
    }
    return { key, outcome: simulate(inp, 'fast', cache).outcome };
  });
}

/** JSON cannot hold Infinity; encode it so unfinished runs round-trip. */
function encode(g: Golden[]): string {
  return JSON.stringify(g, (_k, v: unknown) => (v === Infinity ? 'Infinity' : v), 1);
}
function decode(s: string): Golden[] {
  return JSON.parse(s, (_k, v: unknown) => (v === 'Infinity' ? Infinity : v)) as Golden[];
}

function expectIdentical(actual: Golden[], expected: Golden[]): void {
  expect(actual.map((g) => g.key)).toEqual(expected.map((g) => g.key));
  actual.forEach((a, i) => {
    const e = expected[i]!;
    const nums = (o: Outcome): number[] => [o.totalTime, o.topSpeed, ...o.segmentTimes];
    const an = nums(a.outcome);
    const en = nums(e.outcome);
    expect(an.length, a.key).toBe(en.length);
    an.forEach((x, j) => expect(Object.is(x, en[j]), `${a.key}[${j}] ${x} vs ${en[j]}`).toBe(true));
    expect(a.outcome.finished, a.key).toBe(e.outcome.finished);
    expect(a.columnsHash, a.key).toBe(e.columnsHash);
  });
}

describe('engine golden outcomes (bit-identical across optimisations)', () => {
  if (process.env.UPDATE_GOLDEN === '1') {
    it('writes the golden file', () => {
      writeFileSync(GOLDEN_PATH, encode(compute(false)) + '\n');
    });
    return;
  }

  const golden = decode(readFileSync(GOLDEN_PATH, 'utf8'));

  it('simulate() without a cache reproduces every recorded outcome and column hash', () => {
    expectIdentical(compute(false), golden);
  });

  it('simulate() with a shared SimCache reproduces them too', () => {
    expectIdentical(compute(true), golden);
  });
});
