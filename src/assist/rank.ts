/**
 * The Puzzle assist (contract 08): rank channels by how they move with lap time across the runs
 * so far, with the hint rules that fired acting as priors. Pure and deterministic.
 *
 * Deliberately simple and fully explainable: a filter, not a decider. It surfaces what matters so
 * the engineer decides faster. It never sets a lever and never names one or its value; it only
 * ever returns channel ids, correlations, and a reason taken from a rule's observe tier (which
 * reads a channel) or from the correlation itself.
 *
 * - Feature per channel per run: a clean stat (`summary.clean[id].mean | max | min`). With
 *   `stat` unset, each channel uses whichever of the three has the largest |r|.
 * - r: Pearson correlation of the feature with `outcome.totalTime` across finished runs. A
 *   constant feature has r = 0.
 * - prior: 1 if any fired `HintMatch.channels` across the runs names the channel, else 0.
 * - score: `ruleWeight · prior + (1 − ruleWeight) · |r|`; ties break on |r|, then id.
 * - Fewer than `ASSIST_MIN_RUNS` finished runs → `[]` (the UI shows "Needs 3 runs").
 */
import type { ChannelId, Outcome } from '@/engine/types';
import type { HintMatch } from '@/hints/types';
import type { RunSummary } from '@/telemetry/types';
import { ASSIST_MIN_RUNS } from './config';

export interface AssistRow {
  channel: ChannelId;
  /** Signed Pearson r of the chosen feature with lap time. */
  r: number;
  score: number;
  reason: string;
  /** The rule whose tier-1 text is the reason, or null when the reason is the correlation. */
  fromRule: string | null;
}

export type Stat = 'mean' | 'max' | 'min';

export interface AssistRun {
  summary: RunSummary;
  outcome: Outcome;
  hints: HintMatch[];
}

export interface RankArgs {
  runs: AssistRun[];
  channelIds: ChannelId[];
  /** Per-channel feature; default: whichever stat has the largest |r|. */
  stat?: Stat;
  /** `src/assist/config.ts`, default 0.6. */
  ruleWeight: number;
  /** 5. */
  top: number;
  /**
   * Renders a rule's tier-1 (observe) text for a match, in the player's units. Without it the
   * reason falls back to the correlation line. (Additive to contract 08: `rankChannels` has no
   * level or unit system of its own.)
   */
  describe?: (match: HintMatch) => string | null;
}

const STATS: readonly Stat[] = ['mean', 'max', 'min'];

/** Pearson r; 0 when either series is constant or a value is not finite. */
export function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 2 || y.length !== n) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) return 0;
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  // Relative guard: a feature that only moves by float noise is constant.
  if (sxx <= 1e-18 * (1 + mx * mx) * n || syy <= 0) return 0;
  const r = sxy / Math.sqrt(sxx * syy);
  return Math.max(-1, Math.min(1, r));
}

/** "moves with lap time (r = +0.83)". */
export function correlationReason(r: number): string {
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `moves with lap time (r = ${sign}${Math.abs(r).toFixed(2)})`;
}

export function rankChannels(args: RankArgs): AssistRow[] {
  const runs = args.runs.filter((r) => r.outcome.finished && Number.isFinite(r.outcome.totalTime));
  if (runs.length < ASSIST_MIN_RUNS) return [];
  const times = runs.map((r) => r.outcome.totalTime);
  const w = Math.max(0, Math.min(1, args.ruleWeight));

  // Priors and the most recent rule naming each channel.
  const named = new Map<ChannelId, HintMatch>();
  for (const r of runs) for (const h of r.hints) for (const id of h.channels) named.set(id, h);

  const rows: AssistRow[] = [];
  for (const id of args.channelIds) {
    let best = 0;
    for (const stat of args.stat ? [args.stat] : STATS) {
      const xs = runs.map((r) => r.summary.clean[id]?.[stat] ?? NaN);
      const r = pearson(xs, times);
      if (Math.abs(r) > Math.abs(best)) best = r;
    }
    const match = named.get(id) ?? null;
    const prior = match ? 1 : 0;
    const described = match ? (args.describe?.(match) ?? null) : null;
    rows.push({
      channel: id,
      r: best,
      score: w * prior + (1 - w) * Math.abs(best),
      reason: described ?? correlationReason(best),
      fromRule: described ? match!.ruleId : null,
    });
  }
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(b.r) - Math.abs(a.r) ||
      (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0),
  );
  return rows.slice(0, Math.max(0, args.top));
}

/**
 * The debrief's spurious-correlation note: the first run count `n` (≥ 3) at which raw
 * correlation alone (`ruleWeight = 0`) put an echo channel in the top `top`, but the rule priors
 * kept it out. Null when that never happened.
 */
export function demotedEcho(args: {
  runs: AssistRun[];
  channelIds: ChannelId[];
  isEcho: (id: ChannelId) => boolean;
  ruleWeight: number;
  top: number;
}): { n: number; channel: ChannelId; rawRank: number } | null {
  for (let n = ASSIST_MIN_RUNS; n <= args.runs.length; n++) {
    const slice = args.runs.slice(0, n);
    const raw = rankChannels({ ...args, runs: slice, ruleWeight: 0 });
    const assisted = new Set(rankChannels({ ...args, runs: slice }).map((r) => r.channel));
    const i = raw.findIndex((r) => args.isEcho(r.channel) && !assisted.has(r.channel));
    if (i >= 0) return { n, channel: raw[i]!.channel, rawRank: i + 1 };
  }
  return null;
}
