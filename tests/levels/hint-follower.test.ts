/**
 * Stage 11 acceptance gate: a first-time player who follows only the brief's defaults and the
 * hints reaches the target on every level in at most 6 runs.
 *
 * The bot (`hint-bot.ts`) reads only what the player sees: lever specs, pass or fail, and the
 * top-ranked hint's tier-3 text, applied one lever step per run. It never reads the optimum: the
 * second test hands it a grid whose optimum setup is nonsense and checks it plays identically.
 */
import { describe, expect, it } from 'vitest';
import { LEVELS } from '@/levels/index';
import { describeRuns, followHints, gridFor } from './hint-bot';

const MAX_RUNS = 6;
const T = { timeout: 60_000 };

describe.each(LEVELS.map((l) => [l.id, l] as const))('%s: hint-follower bot', (id, level) => {
  it(`reaches the target from the defaults in ≤ ${MAX_RUNS} runs`, T, () => {
    const r = followHints(level, gridFor(level));
    console.log(`${id}: ${r.passedAt ?? 'no pass'} runs\n${describeRuns(r)}`);
    expect(r.stuck, describeRuns(r)).toBeUndefined();
    expect(r.passedAt).not.toBeNull();
    expect(r.passedAt!).toBeLessThanOrEqual(MAX_RUNS);
  });

  it('never reads the optimum: a scrambled optimum setup changes nothing', T, () => {
    const g = gridFor(level);
    const scrambled = {
      ...g,
      optimum: {
        ...g.optimum,
        setup: { throttle_ramp: 3, tire_pressure: 2.2, weight_dist: 0.38, wing: 0 },
      },
    };
    const a = followHints(level, g);
    const b = followHints(level, scrambled);
    expect(b.runs.map((x) => [x.setup, x.time, x.rule])).toEqual(
      a.runs.map((x) => [x.setup, x.time, x.rule]),
    );
  });
});
