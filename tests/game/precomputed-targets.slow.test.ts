/**
 * `npm run test:slow`: recomputes every level's grid search and compares it bit-for-bit with
 * `src/game/precomputed-targets.json` (every field but the wall-clock `ms`). Catches engine
 * equation changes that do not move the config hash.
 */
import { describe, expect, it } from 'vitest';
import { gridKey } from '@/game/config-hash';
import { gridSearch } from '@/game/grid-search';
import { decodePrecomputed, encodePrecomputed } from '@/game/precomputed';
import raw from '@/game/precomputed-targets.json';
import { LEVELS } from '@/levels/index';
import type { GridResult } from '@/worker/types';

const table = decodePrecomputed(raw);
const strip = (g: GridResult): string => encodePrecomputed({ x: { ...g, ms: 0 } });

describe('precomputed targets match a fresh grid search', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))('%s', (_id, level) => {
    const stored = table[gridKey(level)];
    expect(stored, 'run npm run precompute').toBeDefined();
    expect(strip(stored!)).toBe(strip(gridSearch(level)));
  });
});
