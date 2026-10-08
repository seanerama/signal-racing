/**
 * Dev-only grid-search timing for the real levels (Stage 8: `LEVELS`, A1–B4L). Not part of the
 * app or the test suite. Per level, prints the live search (warm, second of two runs) against its
 * contract-05 budget, and the precomputed-target lookup the game actually uses when the config
 * hash matches.
 *
 *   npx tsx scripts/bench-grid.ts
 *
 * Node timings track Chromium's closely (same V8); the e2e suite logs the in-browser B4L time.
 */
import { gridKey } from '../src/game/config-hash';
import { gridSearch } from '../src/game/grid-search';
import { precomputedGrid, precomputedTable } from '../src/game/precomputed';
import { LEVELS } from '../src/levels/index';
import type { LevelId } from '../src/levels/types';

const BUDGET_MS: Record<LevelId, number> = {
  A1: 1000,
  A2: 1000,
  A3: 1000,
  A4: 4000,
  B1L: 2000,
  B4L: 4000,
};

const t0 = performance.now();
await precomputedTable();
console.log(
  `precomputed table load (JSON parse + revive): ${(performance.now() - t0).toFixed(1)} ms`,
);

for (const level of LEVELS) {
  gridSearch(level);
  const r = gridSearch(level);
  const budget = BUDGET_MS[level.id];
  const ok = r.ms < budget ? 'ok  ' : 'OVER';
  const t1 = performance.now();
  const hit = await precomputedGrid(gridKey(level));
  const lookup = performance.now() - t1;
  console.log(
    `${ok} ${level.id.padEnd(4)} live ${r.ms.toFixed(0).padStart(5)} ms / ${budget} ms  ` +
      `${String(r.evaluated).padStart(5)} setups  ${(r.ms / r.evaluated).toFixed(3)} ms/setup  ` +
      `precomputed ${hit ? `${lookup.toFixed(2)} ms` : 'MISSING'}  ` +
      `optimum ${r.optimum.outcome.totalTime.toFixed(3)} s ${JSON.stringify(r.optimum.setup)}`,
  );
}
