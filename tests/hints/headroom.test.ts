/**
 * The generic headroom rule (Stage 11) and the hint-engine additions it needs: `fallback` rules
 * yield to any fault or headroom match, and `{name:channel}` renders a run-time channel id.
 */
import { describe, expect, it } from 'vitest';
import type { Outcome, Setup } from '@/engine/types';
import { evaluateHints, noiseRule, renderTemplate, type NoiseCtx } from '@/hints/engine';
import { headroomLever, LEVER_MOVES, setupHeadroomRule } from '@/hints/headroom';
import type { HintGrid, HintRule } from '@/hints/types';
import type { LevelConfig } from '@/levels/types';
import type { RunSummary } from '@/telemetry/types';
import { STUB_A2 } from '../game/stub-level';

const SUMMARY = { clean: {} } as unknown as RunSummary;
const outcome = (t: number): Outcome => ({
  totalTime: t,
  segmentTimes: [t],
  topSpeed: 80,
  finished: true,
});
const LEVEL: LevelConfig = { ...STUB_A2, channelSet: [...STUB_A2.channelSet, 'mu_rear', 'long_g'] };
const base: Setup = { throttle_ramp: 0, tire_pressure: 1.65, weight_dist: 0.45, wing: 4 };

/** A synthetic grid over the stub's ramp × pressure: a bowl at ramp 0.5, pressure 1.7. */
function bowl(kRamp: number, kPressure: number): HintGrid {
  const samples: Array<{ setup: Setup; totalTime: number }> = [];
  for (let r = 0; r <= 15; r++)
    for (let p = 0; p <= 10; p++) {
      const ramp = r / 10;
      const pressure = +(1.2 + p / 10).toFixed(1);
      samples.push({
        setup: { ...base, throttle_ramp: ramp, tire_pressure: pressure },
        totalTime: 20 + kRamp * (ramp - 0.5) ** 2 + kPressure * (pressure - 1.7) ** 2,
      });
    }
  return { target: 20.01, segmentFloors: [20], samples };
}

describe('headroomLever', () => {
  it('picks the lever with the largest marginal range at the current setup, toward its best', () => {
    const g = bowl(10, 1);
    expect(
      headroomLever(LEVEL, { ...base, throttle_ramp: 1.2, tire_pressure: 1.4 }, g),
    ).toMatchObject({ lever: 'throttle_ramp', dir: -1 });
    expect(
      headroomLever(LEVEL, { ...base, throttle_ramp: 0.5, tire_pressure: 2.1 }, g),
    ).toMatchObject({ lever: 'tire_pressure', dir: -1 });
    const g2 = bowl(1, 50);
    expect(
      headroomLever(LEVEL, { ...base, throttle_ramp: 0, tire_pressure: 1.2 }, g2),
    ).toMatchObject({ lever: 'tire_pressure', dir: 1 });
  });

  it('fills grid points the search skipped from their neighbours', () => {
    const g = bowl(10, 1);
    const sparse = { ...g, samples: g.samples.filter((_, i) => i % 3 !== 0) };
    expect(
      headroomLever(LEVEL, { ...base, throttle_ramp: 1.2, tire_pressure: 1.7 }, sparse),
    ).toMatchObject({ lever: 'throttle_ramp', dir: -1 });
  });

  it('returns null at the optimum', () => {
    expect(
      headroomLever(LEVEL, { ...base, throttle_ramp: 0.5, tire_pressure: 1.7 }, bowl(10, 1)),
    ).toBeNull();
  });
});

describe('setupHeadroomRule', () => {
  const rule = setupHeadroomRule();
  const setup = { ...base, throttle_ramp: 1.2, tire_pressure: 1.7 };

  it('names a lever and a direction (never a value) and the channel that shows it', () => {
    const grid = bowl(10, 1);
    const m = rule.when(SUMMARY, { level: LEVEL, setup, outcome: outcome(25), grid })!;
    expect(m.vars.move).toBe(LEVER_MOVES.throttle_ramp.down);
    const t3 = renderTemplate(rule.tiers[2], m.vars, 'metric');
    expect(t3.text).toBe('Shorten the throttle ramp, and watch long_g.');
    expect(t3.segments).toContainEqual({ kind: 'channel', value: 'long_g' });
    expect(t3.text).not.toMatch(/\d/);
    expect(renderTemplate(rule.tiers[0], m.vars, 'metric').text).not.toMatch(/—|NaN|undefined/);
  });

  it('is silent without a grid, and on or under the target', () => {
    const grid = bowl(10, 1);
    expect(rule.when(SUMMARY, { level: LEVEL, setup, outcome: outcome(25) })).toBeNull();
    expect(rule.when(SUMMARY, { level: LEVEL, setup, outcome: outcome(20.01), grid })).toBeNull();
  });

  it('every move phrase starts with a direction verb and names its lever', () => {
    for (const [id, m] of Object.entries(LEVER_MOVES)) {
      const name = {
        throttle_ramp: 'throttle ramp',
        tire_pressure: 'tire pressure',
        weight_dist: 'weight distribution',
        wing: 'wing',
      }[id]!;
      for (const text of [m.up, m.down]) {
        expect(text).toMatch(/^(Shorten|Lengthen|Raise|Lower|Move) /);
        expect(text).toContain(name);
      }
    }
  });
});

describe('fallback rules in evaluateHints', () => {
  const fault: HintRule = {
    id: 'f',
    kind: 'fault',
    when: () => ({ ruleId: 'f', vars: {}, channels: [] }),
    estTimeCost: () => 0.01,
    tiers: ['a', 'b', 'Lower the wing.'],
  };
  const fallback: HintRule = {
    ...fault,
    id: 'fb',
    kind: 'headroom',
    fallback: true,
    estTimeCost: () => 5,
  };

  it('a fallback match is dropped when a fault or headroom rule fires, kept otherwise', () => {
    const ctx = { level: LEVEL, setup: base, outcome: outcome(20) };
    const with2 = { ...LEVEL, hintRules: [fault, fallback] };
    expect(evaluateHints(with2, SUMMARY, { ...ctx, level: with2 }).map((h) => h.ruleId)).toEqual([
      'f',
    ]);
    const alone = { ...LEVEL, hintRules: [fallback] };
    expect(evaluateHints(alone, SUMMARY, { ...ctx, level: alone }).map((h) => h.ruleId)).toEqual([
      'fb',
    ]);
  });

  it('the noise rule does not silence the fallback', () => {
    const level: LevelConfig = {
      ...LEVEL,
      conditions: { ...LEVEL.conditions, variation: { gripFrac: 0.01, trackTempC: 3 } },
      hintRules: [noiseRule(), fallback],
    };
    const ctx: NoiseCtx = {
      level,
      setup: base,
      outcome: outcome(20),
      previousOutcome: outcome(20.001),
    };
    expect(evaluateHints(level, SUMMARY, ctx).map((h) => h.ruleId)).toEqual(['fb', 'noise']);
  });
});
