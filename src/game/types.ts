/**
 * Game state types (contract 06). Written by Stage 1; Stage 5 implements `startLevel()`
 * (`src/game/session.ts`), progress (`src/game/progress.ts`) and prefs (`src/game/prefs.ts`).
 * FROZEN after Stage 1.
 *
 * Signals are typed via `@preact/signals-core` (framework-free), so this layer never imports
 * `preact` or `@preact/signals` (lint-enforced). The same signal objects work in Preact components.
 */
import type { ReadonlySignal, Signal } from '@preact/signals-core';
import type { Conditions, Outcome, Setup } from '@/engine/types';
import type { HintMatch } from '@/hints/types';
import type { LevelConfig } from '@/levels/types';
import type { RunSummary, RunTelemetry } from '@/telemetry/types';
import type { GridResult } from '@/worker/types';

export type { ReadonlySignal, Signal };

/** One completed player run. */
export interface RunRecord {
  /** 1-based within the level session. */
  index: number;
  setup: Setup;
  seed: number;
  conditions: Conditions;
  outcome: Outcome;
  /** Contract 03; built with `best` = the best run *before* this one. */
  telemetry: RunTelemetry;
  summary: RunSummary;
  /** All rules that fired, ranked by `estTimeCost` descending. */
  hints: HintMatch[];
  /** B4L only. */
  assistOn: boolean;
}

export type LevelStatus = 'computing' | 'ready' | 'passed' | 'exhausted';

/** Live state of one level attempt. Created by `startLevel(level, client)`. */
export interface LevelSession {
  level: LevelConfig;
  /** Null while computing. */
  grid: Signal<GridResult | null>;
  /** 0–1. */
  gridProgress: Signal<number>;
  runs: Signal<RunRecord[]>;
  /** Min `outcome.totalTime` (or min compromise gap for B1L). */
  best: ReadonlySignal<RunRecord | null>;
  /** Runs + hint tiers opened × cost. */
  runsUsed: ReadonlySignal<number>;
  runsLeft: ReadonlySignal<number>;
  /** 0–3, for the *current* top hint; resets when the top rule changes. */
  hintTiersOpened: Signal<number>;
  status: ReadonlySignal<LevelStatus>;
  /** Rejects if no runs are left. A failed sim does NOT consume budget. */
  run(setup: Setup): Promise<RunRecord>;
  /** Consumes `hintCost[tier]`; returns the match whose tier was opened. */
  openHintTier(): HintMatch | null;
  assistOn: Signal<boolean>;
  /** Stage 9, additive: the answer to `level.call` ("Make the call"); null until answered. */
  call: Signal<CallAnswer | null>;
  /**
   * Stage 9: records the answer to `level.call` (once, after run `afterRun`). Costs no runs.
   * Returns the recorded answer, or null if there is no call yet or the option is unknown.
   */
  answerCall(optionId: string): CallAnswer | null;
}

/** A recorded "Make the call" answer. */
export interface CallAnswer {
  afterRun: number;
  optionId: string;
  correct: boolean;
}

/** Persisted per-level progress (`signal.v1.progress`). */
export interface LevelProgress {
  passed: boolean;
  bestScore: number | null;
  /** s. */
  bestTime: number | null;
  attempts: number;
  /** s, per segment (they become the Phase B floor). */
  segmentBests?: number[];
  /** B4L: runs to target with and without the assist. */
  runsToTarget?: { assisted: number[]; unassisted: number[] };
}

/** Report x-axis mode (`signal.v1.axis`). */
export type AxisMode = 'time' | 'distance';
