/**
 * Stage 8 level behaviour: B1L (the aero compromise) and B4L (the Puzzle).
 *
 * - B1L: the grid optimum's compromise gap equals `bestAchievableGap` and passes the amended rule;
 *   the A4 wing (7–8) is wrong here (B1L wants about 3), and `segment_delta` shows it: at the A4
 *   wing the straight pays, and a launch-optimal setup (maximum rear weight, no wing) moves the
 *   cost into the fast corner.
 * - B4L: the optimum passes under base conditions and, with condition variation, on ≥ 8 of 10
 *   seeds (measured: 10 of 10).
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '@/engine/index';
import type { Setup } from '@/engine/types';
import { gridSearch } from '@/game/grid-search';
import { bestAchievableGap, compromiseGap, gapPassLimit, runPasses } from '@/game/session';
import type { RunRecord } from '@/game/types';
import { evaluateHints, renderTier } from '@/hints/engine';
import { A4, B1L, B4L } from '@/levels/index';
import { segmentEndDeltas } from '@/levels/b1l-join';
import type { LevelConfig } from '@/levels/types';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { summarize } from '@/telemetry/summary';
import type { GridResult } from '@/worker/types';
import { buildBaseSimInput, buildSimInput } from '@/worker/build-input';

const grids = new Map<string, GridResult>();
const grid = (level: LevelConfig): GridResult => {
  let g = grids.get(level.id);
  if (!g) grids.set(level.id, (g = gridSearch(level)));
  return g;
};

function play(level: LevelConfig, setup: Partial<Setup>, runIndex = 1) {
  const input = buildSimInput(level, setup, runIndex);
  const { outcome, columns } = simulate(input, 'full');
  const rt = createRunTelemetry({
    physical: columns!,
    channelIds: [...level.channelSet],
    seed: input.seed,
    segmentFloors: grid(level).segmentFloors,
  });
  const summary = summarize(rt);
  const hints = evaluateHints(level, summary, { level, setup: input.setup, outcome });
  return { outcome, summary, hints };
}

const asRecord = (outcome: RunRecord['outcome']): RunRecord =>
  ({ outcome }) as unknown as RunRecord;

const T = { timeout: 60_000 };

describe('B1L: the aero compromise', () => {
  it("the grid optimum's compromise gap is the best achievable gap and passes", T, () => {
    const g = grid(B1L);
    const opt = g.optimum.outcome;
    expect(compromiseGap(opt.totalTime, g)).toBe(bestAchievableGap(g));
    expect(bestAchievableGap(g)).toBeGreaterThan(0);
    expect(runPasses(B1L, asRecord(opt), g)).toBe(true);
    // The player's run of the optimum (B1L has no condition variation) passes too.
    expect(runPasses(B1L, asRecord(play(B1L, g.optimum.setup).outcome), g)).toBe(true);
    // A clearly worse compromise does not.
    const a4wing = play(B1L, { ...g.optimum.setup, wing: 7 }).outcome;
    expect(compromiseGap(a4wing.totalTime, g)).toBeGreaterThan(gapPassLimit(g));
  });

  it('the surprise: A4 wants a high wing, B1L a low one', T, () => {
    expect(grid(A4).optimum.setup.wing).toBeGreaterThanOrEqual(7);
    expect(grid(B1L).optimum.setup.wing).toBeLessThanOrEqual(4);
  });

  it('segment floors are per-segment minima, so Σ floors is below every evaluated total', T, () => {
    const g = grid(B1L);
    const floor = g.segmentFloors.reduce((a, b) => a + b, 0);
    for (const s of g.samples)
      if (Number.isFinite(s.totalTime)) expect(s.totalTime).toBeGreaterThan(floor);
  });

  it('at the A4 wing the straight pays, and segment_paying says lower the wing', T, () => {
    const g = grid(B1L);
    const r = play(B1L, { ...g.optimum.setup, wing: 7 });
    const d = segmentEndDeltas(r.summary);
    expect(d.indexOf(Math.max(...d))).toBe(0);
    const m = r.hints.find((h) => h.ruleId === 'segment_paying')!;
    expect(m.vars.seg).toBe('straight');
    const rule = B1L.hintRules.find((x) => x.id === 'segment_paying')!;
    expect(renderTier(rule, m, 2, 'metric').text).toBe(
      'Lower the wing until the corner starts paying instead.',
    );
  });

  it(
    'a launch-optimal setup (max rear weight, no wing) moves the cost into the fast corner',
    T,
    () => {
      // Stage 11: 1.7 bar is the pressure peak (pOpt).
      const r = play(B1L, { throttle_ramp: 0, tire_pressure: 1.7, weight_dist: 0.52, wing: 0 });
      const d = segmentEndDeltas(r.summary);
      expect(d.indexOf(Math.max(...d))).toBe(1);
      // The straight is at its floor (within 0.05 s): the launch is all it can be.
      expect(d[0]!).toBeLessThan(0.05);
    },
  );

  it('segment_delta ends each segment at segmentTime − floor', T, () => {
    const g = grid(B1L);
    const r = play(B1L, g.optimum.setup);
    const d = segmentEndDeltas(r.summary);
    r.outcome.segmentTimes.forEach((t, i) => expect(d[i]!).toBeCloseTo(t - g.segmentFloors[i]!, 1));
  });

  it('the optimum is quiet: no rule fires', T, () => {
    expect(play(B1L, grid(B1L).optimum.setup).hints.map((h) => h.ruleId)).toEqual([]);
  });
});

describe('B4L: the Puzzle', () => {
  it('the optimum passes under base conditions', T, () => {
    const g = grid(B4L);
    const { outcome } = simulate(buildBaseSimInput(B4L, g.optimum.setup), 'full');
    expect(outcome.totalTime).toBeLessThanOrEqual(g.target);
  });

  it('with condition variation the optimum passes on at least 8 of 10 seeds', T, () => {
    const g = grid(B4L);
    let passes = 0;
    const times: string[] = [];
    for (let run = 1; run <= 10; run++) {
      const { outcome } = simulate(buildSimInput(B4L, g.optimum.setup, run), 'fast');
      times.push(outcome.totalTime.toFixed(3));
      if (outcome.totalTime <= g.target) passes++;
    }
    console.log(
      `B4L optimum over 10 seeds: ${passes}/10 pass (target ${g.target.toFixed(3)} s): ${times.join(' ')}`,
    );
    expect(passes).toBeGreaterThanOrEqual(8);
  });

  it('ships the whole registry, ~210 channels, with 7 causal and a distractor in the default stack', () => {
    expect(B4L.channelSet.length).toBeGreaterThanOrEqual(200);
    expect(B4L.channelRoles.oil_temp).toBe('distractor');
    expect(B4L.defaultStrips).toContain('oil_temp');
    expect(B4L.assist).toBe(true);
    expect(B4L.runBudget).toBe(10);
  });

  it('the default setup (A4 wing) makes the main straight pay', T, () => {
    const r = play(B4L, {});
    expect(r.hints[0]?.ruleId).toBe('segment_paying');
    expect(r.hints[0]?.vars.seg).toBe('main straight');
  });
});
