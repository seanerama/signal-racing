/**
 * A4 Corner (signal.md "A4, Corner"): a short run-up, one constant-radius left, a short run-out.
 * Wing buys corner speed through downforce and costs exit speed through drag; on a segment this
 * short the balance tips toward wing (which sets up B1). The brief points at the track view.
 *
 * Stage 11 (Fable finding 1, Vision Lead decision): only the wing is unlocked. The throttle ramp,
 * tire pressure and weight distribution are locked, shown greyed, at the A3 grid optimum on the
 * final engine (`A3_ANSWER`; a test recomputes it), so a change in the data has one cause and the
 * wing alone reaches the target. Before, weight 0.46 → 0.52 was worth 0.47 s here and the whole
 * wing range 0.19 s, and wing alone could not pass.
 */
import { setupHeadroomRule } from '@/hints/headroom';
import type { HintCtx, HintRule } from '@/hints/types';
import type { RunSummary } from '@/telemetry/types';
import type { LevelConfig } from './types';
import {
  AT_LIMIT,
  AXLE_FORCES,
  brakeWindow,
  cleanMin,
  DRY,
  FLAGS_GRIP,
  lever,
  peakInPhase,
  roles,
  SLIDING,
  TRACK_CORNER,
  wingLever,
} from './common';
import { LOCK_MIN_FRACTION } from './a3-weight';

/**
 * The A3 answer (A3's grid optimum on the final engine): A4 locks the levers A3 taught here, and
 * B1L starts from them. `tests/levels/lessons.test.ts` recomputes A3's optimum and checks it.
 */
export const A3_ANSWER = { throttle_ramp: 0.2, tire_pressure: 1.7, weight_dist: 0.44 } as const;

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

/** The fronts locked braking into the corner for a real part of the braking, or null. */
function entryLock(s: RunSummary) {
  const brake = brakeWindow(s);
  if (!brake) return null;
  const peak = peakInPhase(s, 'front_slip_ratio', brake.tStart, true);
  if (!SLIDING(peak)) return null;
  const w = s.window('front_slip_ratio', SLIDING);
  if (!w || w.tEnd < brake.tStart) return null;
  const tStart = Math.max(w.tStart, brake.tStart);
  const frac = (w.tEnd - tStart) / Math.max(1e-6, brake.tEnd - brake.tStart);
  return frac > LOCK_MIN_FRACTION ? { tStart, tEnd: w.tEnd, peak } : null;
}

/**
 * Fault (A4, Stage 11): the fronts locked braking into the corner. With the weight split locked
 * the lever that loads the fronts is the wing: downforce adds front load in proportion to v², and
 * the braking happens at the top of the run-up's speed.
 */
export function entryLockRule(): HintRule {
  return {
    id: 'entry_lock',
    kind: 'fault',
    when(s, ctx) {
      if (!(ctx.setup.wing < lever(ctx.level, 'wing').max)) return null;
      const l = entryLock(s);
      if (!l) return null;
      return {
        ruleId: 'entry_lock',
        vars: { peak: l.peak, t_start: l.tStart, t_end: l.tEnd },
        window: { channel: 'front_slip_ratio', tStart: l.tStart, tEnd: l.tEnd },
        channels: ['front_slip_ratio', 'downforce', 'load_front'],
      };
    },
    estTimeCost(s) {
      const l = entryLock(s);
      return l ? 0.05 + 0.3 * (l.tEnd - l.tStart) : 0;
    },
    tiers: [
      '`front_slip_ratio` peaked at {peak} braking into the corner, between {t_start:time} and {t_end:time}: the fronts locked.',
      'The fronts carry most of the braking, and their grip is μ times their load. `downforce` adds load that grows with v², and the braking for the corner happens at the top of the run-up, where downforce is largest.',
      'Raise the wing until `front_slip_ratio` stays under 0.10 into the corner.',
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
    'A short run-up, one 80 m left-hander, a short run-out; the driver brakes to the corner limit for you. Wing angle buys corner speed with downforce and pays for it in drag, and it is the only lever: ramp, pressure and weight are locked at the A3 answer. Watch where on the path the speed bottoms out: the track view at the top right follows the cursor.',
  track: TRACK_CORNER,
  flags: FLAGS_GRIP,
  levers: [wingLever(2)],
  lockedLevers: { ...A3_ANSWER },
  runBudget: 7,
  tolerance: 0.005,
  hintCost: [1, 1, 1],
  channelSet: [
    ...AXLE_FORCES,
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
    // Stage 11: the axle forces feed the grip circle but are not what the brief names.
    ...roles('correlated', AXLE_FORCES),
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
  hintRules: [cornerGripLimitedRule(), dragCostRule(), entryLockRule(), setupHeadroomRule()],
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
