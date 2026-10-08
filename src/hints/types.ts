/**
 * Hint types (contracts 04 and 06). Written by Stage 1; the hint engine
 * (`src/hints/engine.ts`) is Stage 5 and rule content is Stages 6 and 8. FROZEN after Stage 1.
 */
import type { ChannelId, Outcome, Setup } from '@/engine/types';
import type { LevelConfig } from '@/levels/types';
import type { RunSummary } from '@/telemetry/types';

/** A fired rule, with the values its templates need. */
export interface HintMatch {
  ruleId: string;
  /** Template vars; numeric values are SI (the formatter converts). */
  vars: Record<string, number | string>;
  /** Shaded on that strip. */
  window?: { channel: ChannelId; tStart: number; tEnd: number };
  /** Channels the rule names (assist priors use these). */
  channels: ChannelId[];
}

/**
 * The level's grid-search result, as much of it as hint rules read (Stage 11, additive): the
 * target and the evaluated samples. Structurally a subset of `GridResult` (contract 05), so the
 * session can pass its grid as is.
 */
export interface HintGrid {
  /** s: the pass line (for B1L's compromise gap at tolerance 0.005 this is the same line). */
  target: number;
  /** s, per segment: the fastest any evaluated setup ran that segment. */
  segmentFloors: readonly number[];
  /** Every evaluated setup and its time (the response surface's input). */
  samples: ReadonlyArray<{ setup: Setup; totalTime: number }>;
}

/** Context passed to rule predicates. */
export interface HintCtx {
  level: LevelConfig;
  setup: Setup;
  outcome: Outcome;
  bestOutcome?: Outcome;
  /**
   * Stage 11, additive: the level's grid result. Read only by the generic headroom rule
   * (`src/hints/headroom.ts`), which stays silent without it.
   */
  grid?: HintGrid;
}

/** One hint rule: a pure predicate over a run summary plus three tiers of templated text. */
export interface HintRule {
  id: string;
  /** `'noise'` rules are implemented generically by the hint engine (active on B4L only in the current version). */
  kind: 'fault' | 'headroom' | 'noise';
  /**
   * Stage 11, additive: a fallback rule's match is kept only when no fault or headroom rule
   * fired on the run (the generic headroom rule, so hints never go silent off target).
   */
  fallback?: boolean;
  /** Pure. Returns a match when the rule fires. */
  when(s: RunSummary, ctx: HintCtx): HintMatch | null;
  /** s. Used to rank co-firing rules (descending). */
  estTimeCost(s: RunSummary, ctx: HintCtx): number;
  /**
   * Templates: `{var}` or `{var:quantity}`; channel ids in backticks, or `{var:channel}` for a
   * channel id chosen at run time.
   * Tier 3 (direct) names a lever and a direction, never a value.
   */
  tiers: [observe: string, explain: string, direct: string];
}

/** A rendered hint tier. `segments` lets the UI render channel ids as links without re-parsing. */
export interface HintText {
  text: string;
  segments: Array<{ kind: 'text' | 'channel' | 'value'; value: string }>;
}
