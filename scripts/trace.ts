/**
 * Dev-only trace of one level run (Stage 9 latch investigation).
 *
 *   npx tsx scripts/trace.ts <levelId> '<setup json>' [runIndex] [everySteps]
 *
 * An empty setup (`{}`) uses the grid-search optimum.
 */
import { simulate } from '../src/engine/index';
import { gridSearch } from '../src/game/grid-search';
import { LEVELS } from '../src/levels/index';
import { buildSimInput } from '../src/worker/build-input';
import type { Setup } from '../src/engine/types';

const [id = 'B4L', json = '{}', runArg = '1', everyArg = '50'] = process.argv.slice(2);
const level = LEVELS.find((l) => l.id === id);
if (!level) throw new Error(`no level ${id}`);
let setup = JSON.parse(json) as Partial<Setup>;
if (Object.keys(setup).length === 0) setup = gridSearch(level).optimum.setup;
console.log('setup', JSON.stringify(setup));
const r = simulate(buildSimInput(level, setup, Number(runArg)), 'full');
const c = r.columns!;
const ids = [
  'speed',
  'throttle',
  'brake',
  'engine_force',
  'grip_budget_rear',
  'grip_used_rear',
  'rear_slip_ratio',
  'front_slip_ratio',
  'tire_temp_fl',
  'tire_temp_rl',
];
console.log(['t', 'seg', 's', ...ids].join('\t'));
const every = Number(everyArg);
for (let i = 0; i < c.n; i += every) {
  console.log(
    [
      c.t[i]!.toFixed(2),
      c.seg[i],
      c.s[i]!.toFixed(0),
      ...ids.map((k) => c.ch[k]![i]!.toFixed(k.includes('force') || k.includes('budget') ? 0 : 3)),
    ].join('\t'),
  );
}
console.log(r.outcome);
