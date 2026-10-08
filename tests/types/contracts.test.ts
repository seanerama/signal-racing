/**
 * Compile-time checks that the frozen contract types fit together (contracts 01, 03–07).
 * The assertions are mostly for `tsc`; at runtime this only checks the sample objects exist.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ChannelId, LeverId, Quantity as EngineQuantity, Setup } from '@/engine/types';
import type { LevelProgress, LevelSession, RunRecord } from '@/game/types';
import type { HintMatch, HintRule } from '@/hints/types';
import type { LevelConfig, LevelId } from '@/levels/types';
import type { StripStackProps } from '@/report/types';
import type { ChannelDef, RunSummary, RunTelemetry } from '@/telemetry/types';
import type { Quantity } from '@/units';
import type { GridResult, RunPayload, SimClient } from '@/worker/types';

describe('contract types', () => {
  it('units re-exports the engine Quantity', () => {
    expectTypeOf<Quantity>().toEqualTypeOf<EngineQuantity>();
  });

  it('a level config can be written against the types', () => {
    const rule: HintRule = {
      id: 'wheelspin_launch',
      kind: 'fault',
      when: (s: RunSummary): HintMatch | null =>
        (s.clean.rear_slip_ratio?.max ?? 0) > 0.1
          ? { ruleId: 'wheelspin_launch', vars: {}, channels: ['rear_slip_ratio'] }
          : null,
      estTimeCost: () => 0.1,
      tiers: ['observe', 'explain', 'direct'],
    };
    const level: LevelConfig = {
      id: 'A2',
      configVersion: 1,
      phase: 'A',
      title: 'Grip',
      concept: 'traction limit',
      brief: 'Brief.',
      track: {
        id: 't',
        segments: [{ id: 'launch', label: 'Launch', kind: 'straight', length: 1000 }],
        standingStart: true,
        laps: 1,
      },
      flags: { tractionLimit: true, pressureAffectsGrip: true, tempAffectsGrip: false },
      levers: [
        {
          id: 'throttle_ramp',
          label: 'Throttle ramp',
          quantity: 'time',
          min: 0,
          max: 1.5,
          step: 0.05,
          default: 0.5,
        },
      ],
      lockedLevers: { weight_dist: 0.45, wing: 4 },
      runBudget: 6,
      tolerance: 0.01,
      hintCost: [1, 1, 1],
      channelSet: ['speed', 'rear_slip_ratio'],
      channelRoles: { speed: 'outcome', rear_slip_ratio: 'causal' },
      defaultStrips: ['speed'],
      hintRules: [rule],
      conditions: { base: { trackTemp: 30, ambientTemp: 20, gripMultiplier: 1 } },
      passOn: 'any_run',
      debrief: { physics: ['One.', 'Two.'], causal: ['rear_slip_ratio'] },
    };
    expect(level.hintRules).toHaveLength(1);
  });

  it('key shapes line up across contracts', () => {
    expectTypeOf<LeverId>().toEqualTypeOf<keyof Setup>();
    expectTypeOf<LevelId>().toEqualTypeOf<'A1' | 'A2' | 'A3' | 'A4' | 'B1L' | 'B4L'>();
    expectTypeOf<RunRecord['telemetry']>().toEqualTypeOf<RunTelemetry>();
    expectTypeOf<LevelSession['grid']['value']>().toEqualTypeOf<GridResult | null>();
    expectTypeOf<SimClient['run']>().returns.toEqualTypeOf<Promise<RunPayload>>();
    expectTypeOf<StripStackProps['strips']>().toEqualTypeOf<ChannelId[]>();
    expectTypeOf<ChannelDef['quantity']>().toEqualTypeOf<Quantity>();
    expectTypeOf<LevelProgress['bestTime']>().toEqualTypeOf<number | null>();
  });
});
