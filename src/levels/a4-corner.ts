/**
 * A4 Corner (signal.md "A4, Corner"): a short run-up, one constant-radius left, a short run-out.
 * Wing buys corner speed through downforce and costs exit speed through drag; on a segment this
 * short the balance tips toward wing (which sets up B1). The brief points at the track view.
 */
import type { HintCtx, HintRule } from '@/hints/types';
import type { RunSummary } from '@/telemetry/types';
import type { LevelConfig } from './types';
import {
  AT_LIMIT,
  DRY,
  FLAGS_GRIP,
  TRACK_CORNER,
  cleanMin,
  lever,
  pressureLever,
  rampLever,
  roles,
  weightLever,
  wingLever,
} from './common';
import { pressureOffPeakRule, wheelspinRule } from './a2-grip';

/** Segment indices on `TRACK_CORNER`. */
const CORNER = 1;
const RUNOUT = 2;

/**
 * Wing settings up to this leave corner time on the table on this segment: the downforce they
 * give is worth more in the corner than the drag costs on 350 m of straight.
 */
export const A4_LOW_WING = 5;

/** Headroom: low wing and the tires at their limit through the corner (A4; segment 1 is the corner). */
export function cornerGripLimitedRule(gate?: (s: RunSummary, ctx: HintCtx) => boolean): HintRule {
  return {
    id: 'corner_grip_limited',
    kind: 'headroom',
    when(s, ctx) {
      if (!(ctx.setup.wing <= A4_LOW_WING)) return null;
      if (gate && !gate(s, ctx)) return null;
      const seg = s.perSegment[CORNER];
      const used = Math.max(seg?.grip_used_front?.max ?? 0, seg?.grip_used_rear?.max ?? 0);
      if (!(used >= AT_LIMIT)) return null;
      const vmin = cleanMin(s, 'corner_min_speed');
      const lat = s.window('lat_g', (v) => Math.abs(v) >= 0.97 * (s.clean.lat_g?.max ?? 0));
      return {
        ruleId: 'corner_grip_limited',
        vars: { vmin, lat: s.clean.lat_g?.max ?? NaN },
        ...(lat ? { window: { channel: 'lat_g', ...lat } } : {}),
        channels: ['lat_g', 'corner_min_speed', 'downforce'],
      };
    },
    estTimeCost: (_s, ctx) => 0.02 * (A4_LOW_WING + 1 - ctx.setup.wing),
    tiers: [
      '`lat_g` sits flat at {lat:accel_g} through the corner and `corner_min_speed` bottoms out at {vmin:speed}: the tires are at their limit the whole way round.',
      'In a corner the tires spend their grip budget on lateral force, and the budget is μ times load. `downforce` adds load that grows with v², so more of it raises the speed the corner allows.',
      'Raise the wing until exit speed stops improving.',
    ],
  };
}

/** Headroom: wing near the top and the run-out slower than on the best run (A4; segment 2 is the run-out). */
export function dragCostRule(): HintRule {
  return {
    id: 'drag_cost',
    kind: 'headroom',
    when(s, ctx) {
      const wing = lever(ctx.level, 'wing');
      if (!(ctx.setup.wing >= wing.max - 1)) return null;
      const best = ctx.bestOutcome;
      const mine = ctx.outcome.segmentTimes[RUNOUT];
      const theirs = best?.segmentTimes[RUNOUT];
      if (mine === undefined || theirs === undefined || !(mine > theirs)) return null;
      return {
        ruleId: 'drag_cost',
        vars: {
          exit: s.clean.exit_speed?.max ?? NaN,
          drag: s.clean.drag_force?.max ?? NaN,
          lost: mine - theirs,
        },
        channels: ['exit_speed', 'drag_force', 'downforce'],
      };
    },
    estTimeCost: (_s, ctx) => {
      const mine = ctx.outcome.segmentTimes[RUNOUT] ?? 0;
      const theirs = ctx.bestOutcome?.segmentTimes[RUNOUT] ?? mine;
      return Math.max(0, mine - theirs);
    },
    tiers: [
      '`exit_speed` was {exit:speed}, and the run-out took {lost:time} longer than on your best run while `drag_force` reached {drag:force}.',
      'Drag grows with the square of the wing setting, downforce only linearly. Past some point the extra corner speed is worth less than the drag costs on the straights either side.',
      'Lower the wing.',
    ],
  };
}

export const A4: LevelConfig = {
  id: 'A4',
  configVersion: 1,
  phase: 'A',
  title: 'Corner',
  concept: 'Friction circle, aero tradeoff',
  brief:
    'A short run-up, one 80 m left-hander, a short run-out; the driver brakes to the corner limit for you. Wing angle buys corner speed with downforce and pays for it in drag. Watch where on the path the speed bottoms out: the track view at the top right follows the cursor.',
  track: TRACK_CORNER,
  flags: FLAGS_GRIP,
  levers: [rampLever(0.4), pressureLever(1.7), weightLever(0.46), wingLever(2)],
  lockedLevers: {},
  runBudget: 7,
  tolerance: 0.005,
  hintCost: [1, 1, 1],
  channelSet: [
    'segment_time',
    'delta_best',
    'top_speed',
    'lat_g',
    'corner_min_speed',
    'exit_speed',
    'downforce',
    'speed',
    'long_g',
    'throttle',
    'brake',
    'steering_angle',
    'yaw_rate',
    'engine_rpm',
    'gear',
    'drag_force',
    'load_front',
    'load_rear',
    'grip_used_front',
    'grip_used_rear',
    'front_slip_ratio',
    'rear_slip_ratio',
    'wheel_speed_rl',
    'mu_rear',
    'oil_temp',
    'water_temp',
    'gearbox_temp',
    'battery_voltage',
    'intake_air_temp',
    'fuel_pressure',
    'steering_torque',
    'gps_altitude',
    'clutch_temp',
    'ambient_pressure',
    'radio_rssi',
    'hydraulic_pressure',
    'pitot_dp_1',
  ],
  channelRoles: {
    ...roles('outcome', ['segment_time', 'delta_best', 'top_speed']),
    ...roles('causal', ['lat_g', 'corner_min_speed', 'exit_speed', 'downforce']),
    ...roles('correlated', [
      'speed',
      'long_g',
      'throttle',
      'brake',
      'steering_angle',
      'yaw_rate',
      'engine_rpm',
      'gear',
      'drag_force',
      'load_front',
      'load_rear',
      'grip_used_front',
      'grip_used_rear',
      'front_slip_ratio',
      'rear_slip_ratio',
      'wheel_speed_rl',
      'mu_rear',
    ]),
    ...roles('distractor', [
      'oil_temp',
      'water_temp',
      'gearbox_temp',
      'battery_voltage',
      'intake_air_temp',
      'fuel_pressure',
      'steering_torque',
      'gps_altitude',
      'clutch_temp',
      'ambient_pressure',
      'radio_rssi',
      'hydraulic_pressure',
      'pitot_dp_1',
    ]),
  },
  defaultStrips: ['segment_time', 'speed', 'throttle', 'brake', 'steering_angle'],
  hintRules: [cornerGripLimitedRule(), dragCostRule(), wheelspinRule(), pressureOffPeakRule()],
  conditions: DRY,
  passOn: 'any_run',
  scoreTarget: 'time',
  debrief: {
    physics: [
      'A tire has one grip budget, μ times load, shared between braking, driving and cornering, so in the corner `lat_g` sits flat at the limit and `corner_min_speed` is set by how much load the tires carry.',
      'Wing adds `downforce`, and so load, in proportion to v², but drag grows faster than downforce as the wing goes up; on a segment this short the corner is worth more than the straights, so the best wing is high.',
    ],
    causal: ['lat_g', 'corner_min_speed', 'exit_speed', 'downforce'],
  },
};
