/**
 * Dev-only: play a level from the terminal, one run at a time, seeing what the player sees.
 * Pass every run so far; the last run is reported in full (result, Δtarget, the top hint's three
 * tiers, and the clean min/max/mean of the channels you pull in). Used to record the demo history
 * by hand (Stage 11).
 *
 *   RUNS='[{}, {"wing":6}]' CH='rear_slip_ratio,front_slip_ratio' npx tsx scripts/play.ts B4L
 */
import type { Outcome, PhysicalColumns, Setup } from '../src/engine/types';
import { renderTier, ruleFor } from '../src/hints/engine';
import { getLevel } from '../src/levels/index';
import { runSeed } from '../src/worker/build-input';
import { gridFor, passes, playRun } from '../tests/levels/hint-bot';

const level = getLevel(process.argv[2] ?? 'B4L')!;
const runs = JSON.parse(process.env.RUNS ?? '[{}]') as Array<Partial<Setup>>;
const pull = (process.env.CH ?? '').split(',').filter(Boolean);
const g = gridFor(level);
const defaults: Partial<Setup> = {};
for (const l of level.levers) defaults[l.id] = l.default;

let best: { outcome: Outcome; physical: PhysicalColumns } | undefined;
let previous: Outcome | undefined;
console.log(`${level.id} target ${g.target.toFixed(3)} s`);
runs.forEach((change, i) => {
  const setup = { ...defaults, ...change };
  const r = playRun(level, g, setup, i + 1, {
    ...(best ? { best } : {}),
    ...(previous ? { previous } : {}),
  });
  const ok = passes(level, r.outcome, g);
  const t = r.outcome.totalTime;
  console.log(
    `run ${i + 1} seed ${runSeed(level.id, i + 1)} ${JSON.stringify(setup)} ${t.toFixed(3)} s  Δtarget ${(t - g.target).toFixed(3)}${ok ? '  PASS' : ''}  segs ${r.outcome.segmentTimes.map((x) => x.toFixed(2)).join(' ')}`,
  );
  if (i === runs.length - 1) {
    const top = r.hints[0];
    if (top) {
      const rule = ruleFor(level, top)!;
      for (const tier of [0, 1, 2] as const)
        console.log(`  tier ${tier + 1}: ${renderTier(rule, top, tier, 'metric').text}`);
      console.log(
        `  (also fired: ${
          r.hints
            .slice(1)
            .map((h) => h.ruleId)
            .join(', ') || 'none'
        })`,
      );
    } else console.log('  no hint');
    for (const id of pull) {
      const st = r.summary.clean[id];
      if (st)
        console.log(
          `  ${id}: min ${st.min.toFixed(3)} max ${st.max.toFixed(3)} mean ${st.mean.toFixed(3)} (tMax ${st.tMax.toFixed(2)} s)`,
        );
    }
  }
  if (!best || t < best.outcome.totalTime) best = { outcome: r.outcome, physical: r.physical };
  previous = r.outcome;
});
