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

/**
 * Stage 10: there is no run budget, so a session is never `exhausted`; it stays `ready` until a
 * run meets the cut.
 */
export type LevelStatus = 'computing' | 'ready' | 'passed';

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
  /** Runs made (Stage 10: hints are free, so this is just the run count). */
  runsUsed: ReadonlySignal<number>;
  /** Stage 10: hint tiers opened this session (free, but counted and shown). */
  hintsOpened: ReadonlySignal<number>;
  /** Stage 10, the score: index of the first run that met the cut (lower is better); null before. */
  runsToTarget: ReadonlySignal<number | null>;
  /** Stage 10: hints opened before the first passing run; null before a pass. */
  hintsAtPass: ReadonlySignal<number | null>;
  /** 0–3, for the *current* top hint; resets when the top rule changes. */
  hintTiersOpened: Signal<number>;
  status: ReadonlySignal<LevelStatus>;
  /** Never refuses for budget (Stage 10: unlimited runs). Rejects only if the sim fails. */
  run(setup: Setup): Promise<RunRecord>;
  /** Free (Stage 10); counts the tier in `hintsOpened`; returns the match whose tier was opened. */
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
  /** Runs completed when the answer was given (the panel shows the result until the next run). */
  atRun: number;
}

/**
 * Persisted per-level progress (`signal.v1.progress`, envelope version 2 since Stage 10). The
 * score is runs to target (lower is better), with the hints opened by then.
 */
export interface LevelProgress {
  passed: boolean;
  /** Fewest runs to meet the target over all sessions; null if never met. */
  bestRunsToTarget: number | null;
  /** Hints opened in the session that set `bestRunsToTarget`; null if never met. */
  hintsOpenedThen: number | null;
  /** s. */
  bestTime: number | null;
  /** Sessions recorded. */
  attempts: number;
  /** Runs made on this level over all sessions (unlocks the next level at 5, passed or not). */
  runs: number;
  /** s, per segment (they become the Phase B floor). */
  segmentBests?: number[];
  /** B4L: runs to target with and without the assist. */
  runsToTarget?: { assisted: number[]; unassisted: number[] };
}

/** Report x-axis mode (`signal.v1.axis`). */
export type AxisMode = 'time' | 'distance';
