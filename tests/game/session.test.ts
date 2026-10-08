import { effect } from '@preact/signals-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimInputError } from '@/engine/errors';
import type { Outcome, Setup } from '@/engine/types';
import { clearGridCache } from '@/game/grid-cache';
import {
  bestAchievableGap,
  compromiseGap,
  firstPassIndex,
  gapPassLimit,
  runPasses,
  scoreValue,
  startLevel,
} from '@/game/session';
import type { LevelSession, RunRecord } from '@/game/types';
import { A2 as STUB_A2 } from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { createSimClient } from '@/worker/client';
import type { GridResult, SimClient } from '@/worker/types';
import { createInProcessWorker } from '../worker/adapter';

vi.setConfig({ testTimeout: 60_000 });

const SPIN: Setup = { throttle_ramp: 0, tire_pressure: 1.7, weight_dist: 0.45, wing: 4 }; // fires `wheelspin` (Stage 11: pOpt 1.7)
const BAD: Setup = { ...SPIN, throttle_ramp: 9 }; // SimInputError

let client: SimClient;
beforeEach(() => {
  clearGridCache();
  client = createSimClient(createInProcessWorker());
});
afterEach(() => client.dispose());

async function ready(level: LevelConfig = STUB_A2): Promise<LevelSession> {
  const s = startLevel(level, client);
  expect(s.status.value).toBe('computing');
  await new Promise<void>((resolve) => {
    const stop = effect(() => {
      if (s.grid.value) {
        resolve();
        queueMicrotask(() => stop());
      }
    });
  });
  return s;
}

describe('level session', () => {
  it('grid arrives, status computing → ready, progress reaches 1', async () => {
    const s = await ready();
    expect(s.status.value).toBe('ready');
    expect(s.gridProgress.value).toBe(1);
    expect(s.runsUsed.value).toBe(0);
    expect(s.hintsOpened.value).toBe(0);
    expect(s.runsToTarget.value).toBeNull();
  });

  it('hints are free but counted (Stage 10): 2 runs + 2 tiers → runsUsed 2, hintsOpened 2', async () => {
    const s = await ready();
    const r1 = await s.run(SPIN);
    expect(r1.hints[0]?.ruleId).toBe('wheelspin');
    expect(s.openHintTier()?.ruleId).toBe('wheelspin');
    await s.run(SPIN);
    expect(s.hintTiersOpened.value).toBe(1); // same top rule → counter kept
    expect(s.openHintTier()?.ruleId).toBe('wheelspin');
    expect(s.hintTiersOpened.value).toBe(2);
    expect(s.runsUsed.value).toBe(2);
    expect(s.hintsOpened.value).toBe(2);
  });

  it('a failed simulation (forced SimInputError) is not counted', async () => {
    const s = await ready();
    await expect(s.run(BAD)).rejects.toBeInstanceOf(SimInputError);
    expect(s.runsUsed.value).toBe(0);
    expect(s.runs.value).toHaveLength(0);
    const r = await s.run(SPIN);
    expect(r.index).toBe(1);
    expect(s.runsUsed.value).toBe(1);
  });

  it('unlimited runs (Stage 10): runBudget is ignored and the session is never exhausted', async () => {
    const s = await ready({ ...STUB_A2, runBudget: 1 });
    await s.run(SPIN);
    expect(s.status.value).toBe('ready');
    const r2 = await s.run(SPIN);
    const r3 = await s.run(SPIN);
    expect([r2.index, r3.index]).toEqual([2, 3]);
    expect(s.runsUsed.value).toBe(3);
  });

  it('hint cost in the config is ignored: every tier opens after one run', async () => {
    const s = await ready({ ...STUB_A2, runBudget: 1, hintCost: [1, 2, 1] });
    await s.run(SPIN);
    expect(s.openHintTier()).not.toBeNull();
    expect(s.openHintTier()).not.toBeNull();
    expect(s.openHintTier()).not.toBeNull();
    expect(s.hintTiersOpened.value).toBe(3);
    expect(s.hintsOpened.value).toBe(3);
    expect(s.runsUsed.value).toBe(1);
  });

  it('no hint without a fired rule; at most 3 tiers', async () => {
    const s = await ready();
    expect(s.openHintTier()).toBeNull();
    await s.run(SPIN);
    expect([s.openHintTier(), s.openHintTier(), s.openHintTier()].every(Boolean)).toBe(true);
    expect(s.openHintTier()).toBeNull();
    expect(s.hintsOpened.value).toBe(3);
  });

  it('a new run with a different top rule resets the tier counter; opened hints stay counted', async () => {
    const s = await ready();
    await s.run(SPIN);
    s.openHintTier();
    expect(s.hintTiersOpened.value).toBe(1);
    const opt = s.grid.value!.optimum.setup;
    const r2 = await s.run(opt);
    expect(r2.hints).toEqual([]); // the optimum fires no fault
    expect(s.hintTiersOpened.value).toBe(0);
    expect(s.hintsOpened.value).toBe(1);
  });

  it('passing: optimum run → passed; best; runs to target and hints at pass; telemetry built against best', async () => {
    const s = await ready();
    const r1 = await s.run(SPIN);
    s.openHintTier();
    expect(s.best.value).toBe(r1);
    const r2 = await s.run(s.grid.value!.optimum.setup);
    expect(r2.outcome.totalTime).toBeLessThanOrEqual(s.grid.value!.target);
    expect(s.status.value).toBe('passed');
    expect(s.best.value).toBe(r2);
    expect(s.runsToTarget.value).toBe(2);
    expect(s.hintsAtPass.value).toBe(1);
    expect(firstPassIndex(s.level, s.runs.value, s.grid.value)).toBe(2);
    // r2 was built with best = r1, so delta_best is non-trivial; r1 had no best.
    const d2 = r2.telemetry.getClean('delta_best');
    expect(d2.some((v) => Math.abs(v) > 1e-3)).toBe(true);
    // Records carry per-run seeds, full setups and summaries.
    expect(r1.seed).not.toBe(r2.seed);
    expect(r2.setup).toEqual({ ...s.grid.value!.optimum.setup });
    expect(r2.summary.clean.speed).toBeDefined();
    // Running on (and opening hints) after passing does not change the score.
    await s.run(SPIN);
    s.openHintTier();
    expect(s.runsToTarget.value).toBe(2);
    expect(s.hintsAtPass.value).toBe(1);
    expect(s.status.value).toBe('passed');
  });

  it('concurrent run() calls are queued with dense indices; assistOn is recorded', async () => {
    const s = await ready();
    s.assistOn.value = true;
    const [a, b] = await Promise.all([s.run(SPIN), s.run({ ...SPIN, throttle_ramp: 0.5 })]);
    expect([a.index, b.index]).toEqual([1, 2]);
    expect(a.assistOn).toBe(true);
    expect(s.runs.value.map((r) => r.index)).toEqual([1, 2]);
  });

  it('run() before the grid is ready waits for it', async () => {
    const s = startLevel(STUB_A2, client);
    expect(s.status.value).toBe('computing');
    const r = await s.run(SPIN);
    expect(r.index).toBe(1);
    expect(s.grid.value).not.toBeNull();
  });
});

describe('scoring comparators', () => {
  const grid: GridResult = {
    levelId: 'B1L',
    configHash: 'x',
    optimum: {
      setup: {} as Setup,
      outcome: { totalTime: 30, segmentTimes: [20, 10], topSpeed: 0, finished: true },
    },
    target: 30.15,
    segmentFloors: [19.5, 9.5],
    samples: [],
    evaluated: 0,
    ms: 0,
  };
  const rec = (t: number): RunRecord =>
    ({
      outcome: { totalTime: t, segmentTimes: [], topSpeed: 0, finished: true } satisfies Outcome,
    }) as unknown as RunRecord;
  const B1L: LevelConfig = { ...STUB_A2, id: 'B1L', scoreTarget: 'compromise_gap' };

  it('compromise gap = totalTime − Σ floors; B1L passes at gap ≤ best achievable + 0.5% of the optimum time (amended, additive)', () => {
    expect(bestAchievableGap(grid)).toBeCloseTo(1, 12);
    expect(compromiseGap(30.004, grid)).toBeCloseTo(1.004, 12);
    // Limit = 1 + 0.005 × 30 = 1.15 s of gap, i.e. totalTime ≤ 30.15.
    expect(gapPassLimit(grid)).toBeCloseTo(1.15, 12);
    expect(runPasses(B1L, rec(30.004), grid)).toBe(true);
    expect(runPasses(B1L, rec(30.006), grid)).toBe(true);
    expect(runPasses(B1L, rec(30.149), grid)).toBe(true);
    expect(runPasses(B1L, rec(30.151), grid)).toBe(false);
  });

  it('the old multiplicative rule only passed the exact optimum when the best gap is 0', () => {
    const zero: GridResult = { ...grid, segmentFloors: [20, 10] };
    expect(bestAchievableGap(zero)).toBeCloseTo(0, 12);
    // A run 0.1 s off the optimum still passes under the additive rule.
    expect(runPasses(B1L, rec(30.1), zero)).toBe(true);
    expect(runPasses(B1L, rec(30.2), zero)).toBe(false);
    // A time-scored level uses the target instead.
    expect(runPasses(STUB_A2, rec(30.1), grid)).toBe(true);
    expect(runPasses(STUB_A2, rec(30.2), grid)).toBe(false);
  });

  it('best is by gap for B1L and by time otherwise; unfinished runs never win', () => {
    expect(scoreValue(B1L, rec(30.5), grid)).toBeCloseTo(1.5, 12);
    expect(scoreValue(STUB_A2, rec(30.5), grid)).toBe(30.5);
    const dnf = {
      outcome: { totalTime: Infinity, segmentTimes: [], topSpeed: 0, finished: false },
    };
    expect(scoreValue(STUB_A2, dnf as unknown as RunRecord, grid)).toBe(Infinity);
  });
});
