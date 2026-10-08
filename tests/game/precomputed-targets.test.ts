/**
 * Precomputed targets (Stage 8 amendment 1), fast checks: every level in `LEVELS` has an entry
 * whose key matches its current config hash, entries are well-formed, and the grid cache uses an
 * entry only on an exact key match (otherwise it falls back to the live worker search, so a stale
 * target is never shown). `precomputed-targets.slow.test.ts` recomputes them bit-for-bit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configHash, gridKey } from '@/game/config-hash';
import { clearGridCache, loadGrid } from '@/game/grid-cache';
import { decodePrecomputed, encodePrecomputed, precomputedTable } from '@/game/precomputed';
import raw from '@/game/precomputed-targets.json';
import { LEVELS, B4L } from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import type { GridResult, SimClient } from '@/worker/types';

afterEach(() => clearGridCache());

const table = decodePrecomputed(raw);

function fakeClient(result: () => GridResult): SimClient & { calls: number } {
  const c = {
    calls: 0,
    run: () => Promise.reject(new Error('not used')),
    gridSearch: () => {
      c.calls++;
      return Promise.resolve(result());
    },
    dispose: () => undefined,
  };
  return c;
}

describe('precomputed-targets.json', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))(
    '%s has an entry for its current config hash',
    (_id, level) => {
      const e = table[gridKey(level)];
      expect(e, `missing ${gridKey(level)}: run npm run precompute`).toBeDefined();
      expect(e!.levelId).toBe(level.id);
      expect(e!.configHash).toBe(configHash(level));
      expect(e!.segmentFloors).toHaveLength(level.track.segments.length);
      expect(e!.samples.length).toBeGreaterThan(0);
      expect(e!.target).toBeCloseTo(e!.optimum.outcome.totalTime * (1 + level.tolerance), 9);
    },
  );

  it('holds only current levels, and is under ~1.5 MB', () => {
    const keys = new Set(LEVELS.map(gridKey));
    for (const k of Object.keys(table)) expect(keys.has(k), k).toBe(true);
    expect(JSON.stringify(raw).length).toBeLessThan(1_500_000);
  });

  it('non-finite numbers survive the JSON round trip', () => {
    const base = table[gridKey(B4L)]!;
    const e: GridResult = {
      ...base,
      samples: [{ setup: base.optimum.setup, totalTime: Infinity }],
    };
    const back = decodePrecomputed(JSON.parse(encodePrecomputed({ k: e })));
    expect(back.k!.samples[0]!.totalTime).toBe(Infinity);
  });
});

describe('grid cache', () => {
  it('uses the precomputed entry when the hash matches (no worker search)', async () => {
    await precomputedTable();
    const client = fakeClient(() => {
      throw new Error('should not search');
    });
    const onProgress = vi.fn();
    const g = await loadGrid(B4L, client, onProgress);
    expect(client.calls).toBe(0);
    expect(g).toEqual(table[gridKey(B4L)]);
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  it('falls back to the live search when the config hash has no entry', async () => {
    const changed: LevelConfig = { ...B4L, tolerance: 0.004 };
    expect(table[gridKey(changed)]).toBeUndefined();
    const live: GridResult = {
      ...table[gridKey(B4L)]!,
      configHash: configHash(changed),
      target: 1,
    };
    const client = fakeClient(() => live);
    const g = await loadGrid(changed, client);
    expect(client.calls).toBe(1);
    expect(g.target).toBe(1);
  });
});
