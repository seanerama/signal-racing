import { describe, expect, it, vi } from 'vitest';
import type { Outcome } from '@/engine/types';
import {
  evaluateHints,
  noiseRule,
  renderTemplate,
  renderTier,
  runToRunSigma,
  type NoiseCtx,
} from '@/hints/engine';
import type { HintRule } from '@/hints/types';
import { STUB_A2 } from '../game/stub-level';
import type { LevelConfig } from '@/levels/types';
import type { RunSummary } from '@/telemetry/types';

const SUMMARY = {} as RunSummary;
const outcome = (t: number): Outcome => ({
  totalTime: t,
  segmentTimes: [t],
  topSpeed: 80,
  finished: true,
});

function rule(id: string, cost: number, fires = true): HintRule {
  return {
    id,
    kind: 'fault',
    when: () => (fires ? { ruleId: id, vars: {}, channels: [] } : null),
    estTimeCost: () => cost,
    tiers: ['a', 'b', 'c'],
  };
}

describe('renderTemplate / renderTier', () => {
  it('{top_speed:speed} → 212.4 km/h (metric) and 132.0 mph (imperial)', () => {
    const vars = { top_speed: 212.4 / 3.6 };
    expect(renderTemplate('Top {top_speed:speed}.', vars, 'metric').text).toBe('Top 212.4 km/h.');
    expect(renderTemplate('Top {top_speed:speed}.', vars, 'imperial').text).toBe('Top 132.0 mph.');
  });

  it('backticked channel ids become channel segments; values become value segments', () => {
    const r = renderTemplate(
      '`rear_slip_ratio` peaked at {peak} at {t:time}; see `speed_diff_rl`.',
      { peak: 0.18349, t: 0.75 },
      'metric',
    );
    expect(r.segments).toEqual([
      { kind: 'channel', value: 'rear_slip_ratio' },
      { kind: 'text', value: ' peaked at ' },
      { kind: 'value', value: '0.183' },
      { kind: 'text', value: ' at ' },
      { kind: 'value', value: r.segments[4]?.value ?? '' },
      { kind: 'text', value: '; see ' },
      { kind: 'channel', value: 'speed_diff_rl' },
      { kind: 'text', value: '.' },
    ]);
    expect(r.segments[4]?.value).toMatch(/^0\.75\d* s$/);
    expect(r.text).toBe(r.segments.map((s) => s.value).join(''));
    expect(r.text.startsWith('rear_slip_ratio peaked at 0.183')).toBe(true);
    expect(r.text).not.toContain('`');
  });

  it('missing vars render as — and string vars are inserted raw', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(renderTemplate('{a} {b}', { a: 'left' }, 'metric').text).toBe('left —');
    vi.restoreAllMocks();
  });

  it('renderTier picks the tier template', () => {
    const r = STUB_A2.hintRules[0]!;
    const m = { ruleId: r.id, vars: { peak: 0.2, t_start: 0.1, t_end: 0.9 }, channels: [] };
    expect(renderTier(r, m, 0, 'metric').segments[0]).toEqual({
      kind: 'channel',
      value: 'rear_slip_ratio',
    });
    expect(renderTier(r, m, 2, 'metric').text).toBe(r.tiers[2]);
  });
});

describe('evaluateHints', () => {
  it('orders co-firing rules by estTimeCost (desc), drops silent rules', () => {
    const level: LevelConfig = {
      ...STUB_A2,
      hintRules: [rule('small', 0.1), rule('silent', 9, false), rule('big', 0.5), rule('mid', 0.3)],
    };
    const ctx = { level, setup: {} as never, outcome: outcome(20) };
    expect(evaluateHints(level, SUMMARY, ctx).map((m) => m.ruleId)).toEqual([
      'big',
      'mid',
      'small',
    ]);
  });

  it('a throwing rule is skipped, not fatal', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: HintRule = {
      ...rule('bad', 1),
      when: () => {
        throw new Error('x');
      },
    };
    const level: LevelConfig = { ...STUB_A2, hintRules: [bad, rule('ok', 0.1)] };
    const ctx = { level, setup: {} as never, outcome: outcome(20) };
    expect(evaluateHints(level, SUMMARY, ctx).map((m) => m.ruleId)).toEqual(['ok']);
    vi.restoreAllMocks();
  });
});

describe('noise rule', () => {
  const level: LevelConfig = {
    ...STUB_A2,
    conditions: {
      base: STUB_A2.conditions.base,
      variation: { gripFrac: 0.01, trackTempC: 3 },
    },
    hintRules: [noiseRule()],
  };
  const sigma = runToRunSigma(level, 40);
  const ctx = (t: number, prev?: number): NoiseCtx => ({
    level,
    setup: {} as never,
    outcome: outcome(t),
    ...(prev !== undefined ? { previousOutcome: outcome(prev) } : {}),
  });

  it('σ comes from the declared variation (0 without one)', () => {
    expect(sigma).toBeGreaterThan(0.05);
    expect(sigma).toBeLessThan(0.2);
    expect(runToRunSigma(STUB_A2, 40)).toBe(0);
  });

  it('fires when |Δ| between the last two runs < 2σ', () => {
    const m = evaluateHints(level, SUMMARY, ctx(40, 40 + 1.5 * sigma));
    expect(m.map((x) => x.ruleId)).toEqual(['noise']);
    expect(m[0]!.vars.band).toBeCloseTo(2 * sigma, 12);
    const text = renderTier(level.hintRules[0]!, m[0]!, 0, 'metric').text;
    expect(text).toMatch(/differs from the last by .* s, inside the run-to-run band/);
  });

  it('stays silent when |Δ| ≥ 2σ, with no previous run, or without variation', () => {
    expect(evaluateHints(level, SUMMARY, ctx(40, 40 - 2.5 * sigma))).toEqual([]);
    expect(evaluateHints(level, SUMMARY, ctx(40))).toEqual([]);
    const still: LevelConfig = { ...STUB_A2, hintRules: [noiseRule()] };
    expect(evaluateHints(still, SUMMARY, { ...ctx(40, 40), level: still })).toEqual([]);
  });

  it('kind is noise and tier 3 names no value', () => {
    const r = noiseRule();
    expect(r.kind).toBe('noise');
    expect(r.tiers[2]).not.toMatch(/\d/);
  });
});
