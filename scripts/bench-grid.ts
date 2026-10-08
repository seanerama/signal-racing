/**
 * Dev-only grid-search timing for the meeting-cut level shapes (Stage 5). Not part of the app or
 * the test suite. Prints wall time, evaluations and the optimum per level against its budget.
 *
 *   npx --yes tsx scripts/bench-grid.ts
 *
 * Node timings track Chromium's closely (same V8); the e2e pipeline test reports the in-browser
 * A2 time. Each level is searched twice and the second (warm) run is reported.
 */
import { gridSearch } from '../src/game/grid-search';
import { BENCH_LEVELS } from '../tests/game/bench-levels';

for (const { level, budgetMs } of BENCH_LEVELS) {
  gridSearch(level);
  const r = gridSearch(level);
  const ok = r.ms < budgetMs ? 'ok  ' : 'OVER';
  console.log(
    `${ok} ${level.id.padEnd(4)} ${r.ms.toFixed(0).padStart(5)} ms / ${budgetMs} ms  ` +
      `${String(r.evaluated).padStart(5)} setups  ${(r.ms / r.evaluated).toFixed(3)} ms/setup  ` +
      `optimum ${r.optimum.outcome.totalTime.toFixed(3)} s ${JSON.stringify(r.optimum.setup)}`,
  );
}
