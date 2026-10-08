/**
 * The reactive level session (contract 06). Main thread; reaches the engine only through the
 * `SimClient` (worker). Signals are `@preact/signals-core`.
 *
 * Budget: `runsUsed = runs + hint runs spent`. A failed simulation consumes nothing. Runs are
 * processed one at a time (queued), so run indices are dense and in order.
 *
 * Hint tiers: `hintTiersOpened` counts tiers opened for the top-ranked rule of the latest run.
 * A new run whose top rule differs resets it to 0; runs already spent on hints stay spent.
 *
 * Best and pass: by total time, or for `scoreTarget: 'compromise_gap'` (B1L) by the compromise
 * gap `totalTime − Σ segmentFloors`; B1L passes at `gap ≤ bestAchievableGap × 1.005` with
 * `bestAchievableGap = optimum.totalTime − Σ segmentFloors`. Other levels pass at
 * `totalTime ≤ grid.target`. `passOn: 'total'` is not in the meeting cut and is treated as
 * `'any_run'`.
 */
import { batch, computed, signal } from '@preact/signals-core';
import { log } from '@/app/log';
import type { PhysicalColumns, Setup } from '@/engine/types';
import { evaluateHints, type NoiseCtx } from '@/hints/engine';
import type { HintMatch } from '@/hints/types';
import type { LevelConfig } from '@/levels/types';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { summarize } from '@/telemetry/summary';
import { effectiveSetup } from '@/worker/build-input';
import type { GridResult, SimClient } from '@/worker/types';
import { loadGrid } from './grid-cache';
import type { LevelSession, LevelStatus, RunRecord } from './types';

export type { LevelSession, RunRecord };

/** Rejection when a run is requested with no budget left. */
export class BudgetError extends Error {
  constructor(message = 'no runs left') {
    super(message);
    this.name = 'BudgetError';
  }
}

/** Phase B pass slack on the compromise gap (contract 06). */
export const GAP_PASS_FACTOR = 1.005;

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** `totalTime − Σ segmentFloors` (s). */
export function compromiseGap(totalTime: number, grid: GridResult): number {
  return totalTime - sum(grid.segmentFloors);
}

/** `optimum.totalTime − Σ segmentFloors` (s). */
export function bestAchievableGap(grid: GridResult): number {
  return compromiseGap(grid.optimum.outcome.totalTime, grid);
}

/** The value a level is scored on (lower is better). */
export function scoreValue(level: LevelConfig, rec: RunRecord, grid: GridResult | null): number {
  if (!rec.outcome.finished) return Infinity;
  if (level.scoreTarget === 'compromise_gap' && grid) {
    return compromiseGap(rec.outcome.totalTime, grid);
  }
  return rec.outcome.totalTime;
}

/** Does this run meet the level's cut? */
export function runPasses(level: LevelConfig, rec: RunRecord, grid: GridResult): boolean {
  if (!rec.outcome.finished) return false;
  if (level.scoreTarget === 'compromise_gap') {
    return compromiseGap(rec.outcome.totalTime, grid) <= bestAchievableGap(grid) * GAP_PASS_FACTOR;
  }
  return rec.outcome.totalTime <= grid.target;
}

/** runsLeft at the moment of first passing, per session (read by `scoreOf`). */
const passScores = new WeakMap<LevelSession, number>();

/** runsLeft at the moment the session first passed; null if it has not passed. */
export function scoreAtPass(session: LevelSession): number | null {
  return passScores.get(session) ?? null;
}

export function startLevel(level: LevelConfig, client: SimClient): LevelSession {
  const grid = signal<GridResult | null>(null);
  const gridProgress = signal(0);
  const runs = signal<RunRecord[]>([]);
  const hintTiersOpened = signal(0);
  const assistOn = signal(false);
  const hintRunsSpent = signal(0);
  /** Runs accepted but not yet finished (reserved against the budget). */
  const inFlight = signal(0);
  const physicalOf = new Map<RunRecord, PhysicalColumns>();

  const gridPromise = loadGrid(level, client, (f) => {
    gridProgress.value = f;
  }).then(
    (g) => {
      batch(() => {
        grid.value = g;
        gridProgress.value = 1;
      });
      return g;
    },
    (err: unknown) => {
      log.error(`grid search for ${level.id} failed`, err);
      throw err;
    },
  );
  // Observed by run(); avoid an unhandled rejection if no run is ever requested.
  gridPromise.catch(() => undefined);

  const runsUsed = computed(() => runs.value.length + hintRunsSpent.value);
  const runsLeft = computed(() => Math.max(0, level.runBudget - runsUsed.value));

  const best = computed<RunRecord | null>(() => {
    let b: RunRecord | null = null;
    let bv = Infinity;
    for (const r of runs.value) {
      const v = scoreValue(level, r, grid.value);
      if (v < bv) {
        b = r;
        bv = v;
      }
    }
    return b;
  });

  const passed = computed(() => {
    const g = grid.value;
    return g ? runs.value.some((r) => runPasses(level, r, g)) : false;
  });

  const status = computed<LevelStatus>(() => {
    if (!grid.value) return 'computing';
    if (passed.value) return 'passed';
    if (runsLeft.value <= 0) return 'exhausted';
    return 'ready';
  });

  let queue: Promise<unknown> = Promise.resolve();

  const execute = async (setup: Setup): Promise<RunRecord> => {
    const g = await gridPromise;
    const runIndex = runs.value.length + 1;
    const payload = await client.run({ levelId: level.id, setup, runIndex });
    const prior = runs.value;
    const prevBest = best.value;
    const prevRun = prior[prior.length - 1];
    const bestPhysical = prevBest ? physicalOf.get(prevBest) : undefined;
    const telemetry = createRunTelemetry({
      physical: payload.physical,
      channelIds: [...level.channelSet],
      seed: payload.seed,
      ...(bestPhysical ? { best: bestPhysical } : {}),
      segmentFloors: g.segmentFloors,
    });
    const summary = summarize(telemetry);
    const fullSetup = effectiveSetup(level, setup);
    const ctx: NoiseCtx = {
      level,
      setup: fullSetup,
      outcome: payload.outcome,
      ...(prevBest ? { bestOutcome: prevBest.outcome } : {}),
      ...(prevRun ? { previousOutcome: prevRun.outcome } : {}),
    };
    const hints: HintMatch[] = evaluateHints(level, summary, ctx);
    const record: RunRecord = {
      index: runIndex,
      setup: fullSetup,
      seed: payload.seed,
      conditions: payload.conditions,
      outcome: payload.outcome,
      telemetry,
      summary,
      hints,
      assistOn: assistOn.value,
    };
    physicalOf.set(record, payload.physical);

    const wasPassed = passed.value;
    batch(() => {
      if (prevRun?.hints[0]?.ruleId !== hints[0]?.ruleId) hintTiersOpened.value = 0;
      runs.value = [...prior, record];
    });
    if (!wasPassed && passed.value && !passScores.has(session)) {
      passScores.set(session, runsLeft.value);
    }
    return record;
  };

  const session: LevelSession = {
    level,
    grid,
    gridProgress,
    runs,
    best,
    runsUsed,
    runsLeft,
    hintTiersOpened,
    status,
    assistOn,
    run(setup) {
      if (runsLeft.value - inFlight.value <= 0) return Promise.reject(new BudgetError());
      inFlight.value++;
      const p = queue.then(() => execute(setup));
      queue = p.catch(() => undefined);
      return p.finally(() => {
        inFlight.value--;
      });
    },
    openHintTier() {
      const latest = runs.value[runs.value.length - 1];
      const top = latest?.hints[0];
      if (!top) return null;
      const tier = hintTiersOpened.value;
      if (tier >= 3) return null;
      const cost = level.hintCost[tier as 0 | 1 | 2];
      if (runsLeft.value - inFlight.value < cost) return null;
      batch(() => {
        hintRunsSpent.value += cost;
        hintTiersOpened.value = tier + 1;
      });
      return top;
    },
  };
  return session;
}
