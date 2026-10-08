/**
 * Contract 08 validation (synthetic): 10 runs, one truly causal channel and three `speed_echo`
 * distractors. With the rule priors on, the causal channel ranks #1; with `ruleWeight = 0` at
 * least one echo outranks it (the "spurious correlation" point the debrief makes). Plus purity,
 * determinism, the "Needs 3 runs" state, and the no-lever guarantee.
 */
import { describe, expect, it } from 'vitest';
import { ASSIST_TOP, RULE_WEIGHT } from '@/assist/config';
import {
  correlationReason,
  demotedEcho,
  pearson,
  rankChannels,
  type AssistRun,
} from '@/assist/rank';
import type { Outcome } from '@/engine/types';
import type { HintMatch } from '@/hints/types';
import type { ChannelStats, RunSummary } from '@/telemetry/types';

/** Deterministic pseudo-random in [−1, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

const stat = (v: number): ChannelStats => ({
  min: v - 1,
  max: v + 1,
  mean: v,
  argmin: 0,
  argmax: 0,
  tMin: 0,
  tMax: 0,
  dropouts: 0,
});

const summaryOf = (values: Record<string, number>): RunSummary => {
  const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, stat(v)]));
  return { stats: clean, clean, window: () => null, perSegment: [] };
};

const outcome = (t: number): Outcome => ({
  totalTime: t,
  segmentTimes: [t],
  topSpeed: 50,
  finished: true,
});

const CAUSAL = 'rear_slip_ratio';
const ECHOES = ['pitot_dp_1', 'pitot_dp_2', 'pitot_dp_3'];
const IRRELEVANT = ['oil_temp', 'battery_voltage', 'radio_rssi'];
const IDS = [CAUSAL, ...ECHOES, ...IRRELEVANT];

/**
 * Lap time = slip (the cause) + condition noise. The echoes follow top speed, which here moves
 * with the conditions (a grippier day is faster everywhere), so they track lap time more tightly
 * than the cause does over ten runs: correlation without explanation.
 */
function synthetic(): AssistRun[] {
  const rnd = lcg(7);
  const runs: AssistRun[] = [];
  for (let i = 0; i < 10; i++) {
    const slip = 0.1 + 0.05 * rnd();
    const cond = 0.6 * rnd();
    const t = 40 + 8 * slip + cond;
    const hints: HintMatch[] =
      slip > 0.1 ? [{ ruleId: 'wheelspin', vars: {}, channels: [CAUSAL, 'wheel_speed_rl'] }] : [];
    const v: Record<string, number> = { [CAUSAL]: slip };
    ECHOES.forEach((id, k) => (v[id] = 1 - 0.8 * t + 0.02 * k * rnd()));
    IRRELEVANT.forEach((id) => (v[id] = 50 + 5 * rnd()));
    runs.push({ summary: summaryOf(v), outcome: outcome(t), hints });
  }
  return runs;
}

describe('rankChannels (contract 08)', () => {
  const runs = synthetic();

  it('with the rule priors on, the causal channel ranks #1', () => {
    const rows = rankChannels({ runs, channelIds: IDS, ruleWeight: RULE_WEIGHT, top: ASSIST_TOP });
    expect(rows).toHaveLength(5);
    expect(rows[0]!.channel).toBe(CAUSAL);
    expect(rows[0]!.fromRule).toBe(null); // no describe(): the reason is the correlation
  });

  it('with ruleWeight = 0, at least one echo outranks the causal channel', () => {
    const rows = rankChannels({ runs, channelIds: IDS, ruleWeight: 0, top: ASSIST_TOP });
    const causalAt = rows.findIndex((r) => r.channel === CAUSAL);
    const firstEcho = rows.findIndex((r) => ECHOES.includes(r.channel));
    expect(firstEcho).toBeGreaterThanOrEqual(0);
    expect(causalAt === -1 || firstEcho < causalAt).toBe(true);
  });

  it('score = w·prior + (1 − w)·|r|, r is signed', () => {
    const rows = rankChannels({ runs, channelIds: IDS, ruleWeight: 0.6, top: 7 });
    for (const r of rows) {
      const prior = r.channel === CAUSAL ? 1 : 0;
      expect(r.score).toBeCloseTo(0.6 * prior + 0.4 * Math.abs(r.r), 12);
    }
    // Echoes fall as time rises.
    expect(rows.find((r) => r.channel === 'pitot_dp_1')!.r).toBeLessThan(-0.9);
  });

  it('needs 3 finished runs; returns [] before that', () => {
    expect(
      rankChannels({ runs: runs.slice(0, 2), channelIds: IDS, ruleWeight: 0.6, top: 5 }),
    ).toEqual([]);
    const dnf = { ...runs[2]!, outcome: { ...runs[2]!.outcome, finished: false } };
    expect(
      rankChannels({ runs: [runs[0]!, runs[1]!, dnf], channelIds: IDS, ruleWeight: 0.6, top: 5 }),
    ).toEqual([]);
    expect(
      rankChannels({ runs: runs.slice(0, 3), channelIds: IDS, ruleWeight: 0.6, top: 5 }),
    ).toHaveLength(5);
  });

  it('is pure and deterministic', () => {
    const snapshot = JSON.stringify(runs.map((r) => [r.summary.clean, r.outcome, r.hints]));
    const a = rankChannels({ runs, channelIds: IDS, ruleWeight: 0.6, top: 5 });
    const b = rankChannels({ runs, channelIds: [...IDS], ruleWeight: 0.6, top: 5 });
    expect(a).toEqual(b);
    expect(JSON.stringify(runs.map((r) => [r.summary.clean, r.outcome, r.hints]))).toBe(snapshot);
  });

  it('reason: the latest naming rule via describe(), else the correlation line', () => {
    const rows = rankChannels({
      runs,
      channelIds: IDS,
      ruleWeight: 0.6,
      top: 5,
      describe: (m) => `rule ${m.ruleId} fired`,
    });
    expect(rows[0]).toMatchObject({
      channel: CAUSAL,
      reason: 'rule wheelspin fired',
      fromRule: 'wheelspin',
    });
    for (const r of rows.slice(1)) expect(r.reason).toBe(correlationReason(r.r));
    expect(correlationReason(-0.834)).toBe('moves with lap time (r = −0.83)');
    expect(correlationReason(0.5)).toBe('moves with lap time (r = +0.50)');
  });

  it('a fixed stat is honoured', () => {
    const rows = rankChannels({ runs, channelIds: IDS, stat: 'max', ruleWeight: 0, top: 7 });
    expect(rows).toHaveLength(7);
  });

  it('demotedEcho finds the run where priors pushed an echo out of the top five', () => {
    const d = demotedEcho({
      runs,
      channelIds: IDS,
      isEcho: (id) => ECHOES.includes(id),
      ruleWeight: RULE_WEIGHT,
      top: 2,
    });
    expect(d).not.toBeNull();
    expect(ECHOES).toContain(d!.channel);
    expect(d!.n).toBeGreaterThanOrEqual(3);
  });
});

describe('pearson', () => {
  it('±1 on lines, 0 on constants and non-finite input', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([5, 5, 5], [1, 2, 3])).toBe(0);
    expect(pearson([1, NaN, 3], [1, 2, 3])).toBe(0);
  });
});
