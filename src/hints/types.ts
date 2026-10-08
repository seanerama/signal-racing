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

/** Context passed to rule predicates. */
export interface HintCtx {
  level: LevelConfig;
  setup: Setup;
  outcome: Outcome;
  bestOutcome?: Outcome;
}

/** One hint rule: a pure predicate over a run summary plus three tiers of templated text. */
export interface HintRule {
  id: string;
  /** `'noise'` rules are implemented generically by the hint engine (active on B4L only in the meeting cut). */
  kind: 'fault' | 'headroom' | 'noise';
  /** Pure. Returns a match when the rule fires. */
  when(s: RunSummary, ctx: HintCtx): HintMatch | null;
  /** s. Used to rank co-firing rules (descending). */
  estTimeCost(s: RunSummary, ctx: HintCtx): number;
  /**
   * Templates: `{var}` or `{var:quantity}`; channel ids in backticks.
   * Tier 3 (direct) names a lever and a direction, never a value.
   */
  tiers: [observe: string, explain: string, direct: string];
}

/** A rendered hint tier. `segments` lets the UI render channel ids as links without re-parsing. */
export interface HintText {
  text: string;
  segments: Array<{ kind: 'text' | 'channel' | 'value'; value: string }>;
}
