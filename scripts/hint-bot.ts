/**
 * Dev-only: runs the hint-follower bot (tests/levels/hint-bot.ts) on every level and prints its
 * runs. The test `tests/levels/hint-follower.test.ts` asserts the same thing.
 *
 *   npx tsx scripts/hint-bot.ts [LEVEL]
 *   DEFAULTS='[{"wing":6},{"wing":5}]' npx tsx scripts/hint-bot.ts B1L   # try other lever defaults
 */
import type { Setup } from '../src/engine/types';
import { gridSearch } from '../src/game/grid-search';
import { LEVELS } from '../src/levels/index';
import type { LevelConfig } from '../src/levels/types';
import { describeRuns, followHints } from '../tests/levels/hint-bot';

const only = process.argv[2];
const variants = JSON.parse(process.env.DEFAULTS ?? '[{}]') as Array<Partial<Setup>>;
for (const base of LEVELS) {
  if (only && base.id !== only) continue;
  const g = gridSearch(base);
  for (const d of variants) {
    const level: LevelConfig = {
      ...base,
      levers: base.levers.map((l) => (d[l.id] !== undefined ? { ...l, default: d[l.id]! } : l)),
    };
    const r = followHints(level, g);
    console.log(
      `${level.id} ${JSON.stringify(d)}: target ${g.target.toFixed(3)} (optimum ${g.optimum.outcome.totalTime.toFixed(3)} ${JSON.stringify(g.optimum.setup)}) → ${r.passedAt ? `PASS in ${r.passedAt} runs` : `FAIL (${r.stuck})`}`,
    );
    console.log(describeRuns(r));
  }
}
