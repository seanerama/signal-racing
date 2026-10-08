/**
 * Dev-only: lists every grid setup where following a fired hint one step makes the next run
 * slower (tests/levels/one-step.ts).
 *
 *   npx tsx scripts/one-step.ts A2
 */
import { gridSearch } from '../src/game/grid-search';
import { getLevel } from '../src/levels/index';
import { oneStepViolations } from '../tests/levels/one-step';

const level = getLevel(process.argv[2] ?? 'A2')!;
const g = gridSearch(level);
const v = oneStepViolations(level, g);
console.log(
  `${level.id}: ${v.length} violations (${v.filter((x) => x.top).length} on the top hint)`,
);
for (const x of v)
  console.log(
    `  ${x.top ? 'TOP' : '   '} ${JSON.stringify(x.setup)} ${x.rule}: ${x.from.toFixed(3)} → ${x.to.toFixed(3)} | ${x.direct}`,
  );
