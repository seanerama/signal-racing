/**
 * The reactive level session (contract 06). Main thread; reaches the engine only through the
 * `SimClient` (worker). Signals are `@preact/signals-core`.
 *
 * Stage 10 rules (Vision Lead): there is **no run budget** and **hints are free**. `run()` never
 * refuses for budget (`LevelConfig.runBudget` and `hintCost` are ignored here). Hints are still
 * counted (`hintsOpened`). The score is **runs to target**: the index of the first run that
 * meets the cut (lower is better), shown with the hints opened by then (`hintsAtPass`). A failed
 * simulation consumes nothing. Runs are processed one at a time (queued), so run indices are
 * dense and in order.
 *
 * Hint tiers: `hintTiersOpened` counts tiers opened for the top-ranked rule of the latest run.
 * A new run whose top rule differs resets it to 0; `hintsOpened` keeps the session total.
 *
 * Best and pass: by total time, or for `scoreTarget: 'compromise_gap'` (B1L) by the compromise
 * gap `totalTime − Σ segmentFloors`; B1L passes at
 * `gap ≤ bestAchievableGap + tolerance × optimum.totalTime` (contract 06, amended: additive, since a
 * multiplicative slack on a gap that can be 0 only ever passes the exact optimum), with
 * `bestAchievableGap = optimum.totalTime − Σ segmentFloors`. Other levels pass at
 * `totalTime ≤ grid.target`. `passOn: 'total'` is not in the current version and is treated as
 * `'any_run'`.
 *
 * "Make the call" (Stage 9): `answerCall` records the player's answer to `level.call` once the
 * named run exists. It costs no runs and can be given once per session.
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
import type { CallAnswer, LevelSession, LevelStatus, RunRecord } from './types';

export type { LevelSession, RunRecord };

/** Phase B pass slack on the compromise gap, as a fraction of the optimum time (contract 06). */
export const GAP_TOLERANCE = 0.005;

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

/** The largest compromise gap that passes: `bestAchievableGap + 0.005 × optimum.totalTime` (s). */
export function gapPassLimit(grid: GridResult): number {
  return bestAchievableGap(grid) + GAP_TOLERANCE * grid.optimum.outcome.totalTime;
}

/** Does this run meet the level's cut? */
export function runPasses(level: LevelConfig, rec: RunRecord, grid: GridResult): boolean {
  if (!rec.outcome.finished) return false;
  if (level.scoreTarget === 'compromise_gap') {
    return compromiseGap(rec.outcome.totalTime, grid) <= gapPassLimit(grid);
  }
  return rec.outcome.totalTime <= grid.target;
}

/** Index (1-based) of the first run that meets the cut; null if none has. */
export function firstPassIndex(
  level: LevelConfig,
  runs: readonly RunRecord[],
  grid: GridResult | null,
): number | null {
  if (!grid) return null;
  return runs.find((r) => runPasses(level, r, grid))?.index ?? null;
}

export function startLevel(level: LevelConfig, client: SimClient): LevelSession {
  const grid = signal<GridResult | null>(null);
  const gridProgress = signal(0);
  const runs = signal<RunRecord[]>([]);
  const hintTiersOpened = signal(0);
  const assistOn = signal(false);
  const hintsOpened = signal(0);
  /** Hints opened when the first passing run arrived (null until a pass). */
  const hintsAtPass = signal<number | null>(null);
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

  const call = signal<CallAnswer | null>(null);
  const runsUsed = computed(() => runs.value.length);

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

  const runsToTarget = computed(() => firstPassIndex(level, runs.value, grid.value));
  const passed = computed(() => runsToTarget.value !== null);

  const status = computed<LevelStatus>(() => {
    if (!grid.value) return 'computing';
    if (passed.value) return 'passed';
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
    const args = {
      physical: payload.physical,
      channelIds: [...level.channelSet],
      seed: payload.seed,
      ...(bestPhysical ? { best: bestPhysical } : {}),
      segmentFloors: g.segmentFloors,
    };
    // Stage 9: planted sensor artifacts live in what the player sees (`get()`, the report, the
    // CSV). Hint rules read a summary of the same run WITHOUT them, so no rule can react to one
    // (the assist reads clean stats, which never carry them).
    const artifacts = (level.artifacts ?? []).filter((a) => a.run === runIndex);
    const telemetry = createRunTelemetry({ ...args, artifacts });
    const summary = summarize(telemetry);
    const ruleSummary = artifacts.length ? summarize(createRunTelemetry(args)) : summary;
    const fullSetup = effectiveSetup(level, setup);
    const ctx: NoiseCtx = {
      level,
      setup: fullSetup,
      grid: g,
      outcome: payload.outcome,
      ...(prevBest ? { bestOutcome: prevBest.outcome } : {}),
      ...(prevRun ? { previousOutcome: prevRun.outcome } : {}),
    };
    const hints: HintMatch[] = evaluateHints(level, ruleSummary, ctx);
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
      if (!wasPassed && passed.value) hintsAtPass.value = hintsOpened.value;
    });
    return record;
  };

  const session: LevelSession = {
    level,
    grid,
    gridProgress,
    runs,
    best,
    runsUsed,
    hintsOpened,
    runsToTarget,
    hintsAtPass,
    hintTiersOpened,
    status,
    assistOn,
    call,
    answerCall(optionId) {
      const spec = level.call;
      if (!spec || call.value) return call.value;
      if (runs.value.length < spec.afterRun) return null;
      const option = spec.options.find((o) => o.id === optionId);
      if (!option) return null;
      call.value = {
        afterRun: spec.afterRun,
        optionId,
        correct: option.correct,
        atRun: runs.value.length,
      };
      return call.value;
    },
    run(setup) {
      const p = queue.then(() => execute(setup));
      queue = p.catch(() => undefined);
      return p;
    },
    openHintTier() {
      const latest = runs.value[runs.value.length - 1];
      const top = latest?.hints[0];
      if (!top) return null;
      const tier = hintTiersOpened.value;
      if (tier >= 3) return null;
      // Free (Stage 10): `level.hintCost` is ignored; the tier is only counted.
      batch(() => {
        hintsOpened.value += 1;
        hintTiersOpened.value = tier + 1;
      });
      return top;
    },
  };
  return session;
}
