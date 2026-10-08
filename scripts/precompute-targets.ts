/**
 * Writes `src/game/precomputed-targets.json`: the grid-search result for every level in
 * `LEVELS`, keyed by `${levelId}:${configHash}` (Stage 8 amendment 1). Runs as `prebuild` and
 * `prebuild:single`, so every build ships targets for its own level configs.
 *
 *   npx tsx scripts/precompute-targets.ts
 *
 * The file is rewritten only when a result differs (ignoring the wall-clock `ms`), so a rebuild
 * on unchanged code leaves the working tree clean. Samples are kept (the response surface uses
 * them) unless the file would exceed ~1.5 MB, in which case each level keeps an evenly
 * downsampled set.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gridKey } from '../src/game/config-hash';
import { gridSearch } from '../src/game/grid-search';
import { decodePrecomputed, encodePrecomputed } from '../src/game/precomputed';
import { LEVELS } from '../src/levels/index';
import type { GridResult } from '../src/worker/types';

const OUT = resolve(import.meta.dirname, '../src/game/precomputed-targets.json');
const MAX_BYTES = 1_500_000;

const previous = existsSync(OUT) ? decodePrecomputed(JSON.parse(readFileSync(OUT, 'utf8'))) : {};
const entries: Record<string, GridResult> = {};
const t0 = performance.now();
for (const level of LEVELS) {
  const key = gridKey(level);
  const r = gridSearch(level);
  const old = previous[key];
  // Keep the previous entry (and its ms) when the result is identical.
  entries[key] = old && sameResult(old, r) ? old : r;
  console.log(
    `${key.padEnd(20)} ${String(r.evaluated).padStart(5)} setups ${r.ms.toFixed(0).padStart(5)} ms  ` +
      `optimum ${r.optimum.outcome.totalTime.toFixed(3)} s ${JSON.stringify(r.optimum.setup)}`,
  );
}

let text = encodePrecomputed(entries);
if (text.length > MAX_BYTES) {
  const keep = Math.floor((MAX_BYTES / text.length) * 0.9 * 100) / 100;
  for (const e of Object.values(entries)) {
    const step = Math.ceil(1 / keep);
    e.samples = e.samples.filter((_, i) => i % step === 0);
  }
  text = encodePrecomputed(entries);
  console.log(`samples downsampled to fit ${MAX_BYTES} bytes`);
}

const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (before !== text) writeFileSync(OUT, text);
console.log(
  `${before === text ? 'unchanged' : 'wrote'} ${OUT} (${(text.length / 1024).toFixed(0)} KB, ` +
    `${LEVELS.length} levels, ${(performance.now() - t0).toFixed(0)} ms)`,
);

function sameResult(a: GridResult, b: GridResult): boolean {
  return encodePrecomputed({ x: { ...a, ms: 0 } }) === encodePrecomputed({ x: { ...b, ms: 0 } });
}
