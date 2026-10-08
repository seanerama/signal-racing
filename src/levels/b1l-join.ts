/**
 * B1L "Join: straight + fast corner" (signal.md "B1, Join"; lite). A kilometre of
 * straight from a standing start, a 150 m radius 90° right, a 150 m run-out, one setup for all
 * three. The A4 wing (tuned on a short segment) now drags down the straight; lowering it moves
 * the cost into the corner. The best compromise balances the segments' `segment_delta`s.
 *
 * Rough cut: the segment floors are the engine's per-segment minima from the grid search
 * (`segmentFloorSource: 'engine_optimum'`), labelled "engine floor" in the UI, not the player's
 * Phase A bests.
 */
import { setupHeadroomRule } from '@/hints/headroom';
import type { HintCtx, HintRule } from '@/hints/types';
import type { RunSummary } from '@/telemetry/types';
import type { LevelConfig } from './types';
import {
  AXLE_FORCES,
  DRY,
  FLAGS_GRIP,
  pressureLever,
  rampLever,
  roles,
  TRACK_JOIN,
  weightLever,
  wingLever,
} from './common';
import { pressureOffPeakRule, rampTooGentleRule, wheelspinRule } from './a2-grip';
import { frontLockRule, launchSpinRule } from './a3-weight';
import { A3_ANSWER, cornerGripLimitedRule, dragCostRule } from './a4-corner';

/** A segment pays for the compromise when its end-of-segment delta is at least this (s). */
export const PAYING_MIN = 0.05;
/**
 * …and at least this multiple of every other segment's. Segments never pay equally at the best
 * compromise (the floors come from opposite ends of the wing range, and the wing moves the
 * straight more than the corner), so "clearly paying" means well over double.
 */
export const PAYING_RATIO = 2.5;

/** Stage 11: real sensors with no bearing on the join (signal-to-noise, finding 6). */
const B1L_EXTRA_DISTRACTORS = [
  'oil_pressure',
  'radiator_out_temp',
  'fuel_temp',
  'airbox_temp',
  'ecu_temp',
  'lambda_bank_1',
  'damper_temp_fl',
  'brake_duct_temp_front',
  'strain_wing_pillar_r',
  'ambient_air_temp',
  'logger_temp',
];

/** End-of-segment `segment_delta` per segment (s); NaN where the level has no floors. */
export function segmentEndDeltas(s: RunSummary): number[] {
  return s.perSegment.map((seg) => {
    const st = seg.segment_delta;
    if (!st) return NaN;
    // segment_delta is monotone within a segment (it accrues with the run's own time), so its
    // end value is the extreme in the direction it moved.
    return Math.abs(st.max) >= Math.abs(st.min) ? st.max : st.min;
  });
}

/** The segment paying most for the compromise, if one clearly is. */
export function payingSegment(
  s: RunSummary,
  labels: string[],
): { index: number; label: string; delta: number; next: number } | null {
  const d = segmentEndDeltas(s);
  let best = -1;
  for (let i = 0; i < d.length; i++) if (!(d[i]! <= (d[best] ?? -Infinity))) best = i;
  if (best < 0) return null;
  const delta = d[best]!;
  const next = Math.max(
    0,
    ...d.filter((_, i) => i !== best).map((v) => (Number.isFinite(v) ? v : 0)),
  );
  if (!(delta >= PAYING_MIN) || !(delta >= PAYING_RATIO * next)) return null;
  return { index: best, label: labels[best] ?? `segment ${best + 1}`, delta, next };
}

/** Join-level gate for A4's corner rule: only when a corner is clearly the segment paying. */
export function cornerIsPaying(s: RunSummary, ctx: HintCtx): boolean {
  const p = payingSegment(
    s,
    ctx.level.track.segments.map((x) => x.label),
  );
  return !!p && ctx.level.track.segments[p.index]?.kind === 'corner';
}

/**
 * Headroom: one segment is paying clearly more than the others. On a straight the cure is less
 * drag; in a corner, more downforce. Shared by B1L and B4L.
 */
export function segmentPayingRule(): HintRule {
  return {
    id: 'segment_paying',
    kind: 'headroom',
    when(s, ctx) {
      const labels = ctx.level.track.segments.map((x) => x.label.toLowerCase());
      const p = payingSegment(s, labels);
      if (!p) return null;
      const seg = ctx.level.track.segments[p.index];
      const corner = seg?.kind === 'corner';
      const t = s.perSegment[p.index]?.segment_time;
      return {
        ruleId: 'segment_paying',
        vars: {
          seg: p.label,
          delta: p.delta,
          next: p.next,
          dir: corner ? 'Raise' : 'Lower',
          other: corner ? 'the straight' : 'the corner',
        },
        ...(t ? { window: { channel: 'segment_delta', tStart: t.tMin, tEnd: t.tMax } } : {}),
        channels: corner
          ? ['segment_delta', 'corner_min_speed', 'downforce']
          : ['segment_delta', 'top_speed', 'drag_force'],
      };
    },
    estTimeCost(s, ctx) {
      const labels = ctx.level.track.segments.map((x) => x.label);
      const p = payingSegment(s, labels);
      return p ? p.delta - p.next : 0;
    },
    tiers: [
      '`segment_delta` ended the {seg} {delta:time} over its engine floor; no other segment lost more than {next:time}.',
      'Each segment has its own best setup, and the car gets one. A wing that wins the corner drags down the straight, and one that wins the straight gives the corner away; the fastest compromise is where neither segment is paying much more than the other.',
      '{dir} the wing until {other} starts paying instead.',
    ],
  };
}

export const B1L: LevelConfig = {
  id: 'B1L',
  configVersion: 1,
  phase: 'B',
  title: 'Join: straight + fast corner',
  concept: 'The aero compromise',
  brief:
    'A kilometre of straight from a standing start, a fast 150 m right-hander and a short run-out, on one setup, starting with no throttle ramp and a high wing. The score is the compromise gap: your time minus the sum of each segment’s engine floor, the fastest any setup can do it alone. Every lever is free, and more rear weight lets a shorter ramp launch cleanly: the same wheelspin, solved by a different lever. The `segment_time` strip restarts at every dashed boundary; find the strip that shows which segment is paying.',
  track: TRACK_JOIN,
  flags: FLAGS_GRIP,
  // Stage 11: the A3 weight and pressure, no ramp (the A1 instinct) and a high wing (the A4
  // instinct). The launch spins and the straight pays; with no stop on this track, the hints cure
  // the spin with rear weight rather than a ramp (`launch_spin`, `withRamp`).
  levers: [
    rampLever(0),
    pressureLever(A3_ANSWER.tire_pressure),
    weightLever(A3_ANSWER.weight_dist),
    wingLever(5),
  ],
  lockedLevers: {},
  runBudget: 8,
  tolerance: 0.005,
  hintCost: [1, 1, 1],
  channelSet: [
    ...AXLE_FORCES,
    'segment_time',
    'delta_best',
    'segment_delta',
    'top_speed',
    'drag_force',
    'downforce',
    'corner_min_speed',
    'exit_speed',
    'speed',
    'long_g',
    'lat_g',
    'throttle',
    'brake',
    'steering_angle',
    'yaw_rate',
    'engine_rpm',
    'gear',
    'engine_force',
    'power_used',
    'load_front',
    'load_rear',
    'grip_used_front',
    'grip_used_rear',
    'front_slip_ratio',
    'rear_slip_ratio',
    'wheel_speed_rl',
    'mu_rear',
    'brake_temp_front',
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
    'pitot_dp_2',
    'cooling_air_dp',
    'strain_wing_pillar_l',
    'diff_temp',
    // Stage 11: more believable distractors, so 5 causal of 60 (1 in 12).
    ...B1L_EXTRA_DISTRACTORS,
  ],
  channelRoles: {
    // Stage 11: the axle forces feed the grip circle but are not what the brief names.
    ...roles('correlated', AXLE_FORCES),
    ...roles('outcome', ['segment_time', 'delta_best']),
    ...roles('causal', [
      'segment_delta',
      'drag_force',
      'top_speed',
      'corner_min_speed',
      'downforce',
    ]),
    ...roles('correlated', [
      'exit_speed',
      'speed',
      'long_g',
      'lat_g',
      'throttle',
      'brake',
      'steering_angle',
      'yaw_rate',
      'engine_rpm',
      'gear',
      'engine_force',
      'power_used',
      'load_front',
      'load_rear',
      'grip_used_front',
      'grip_used_rear',
      'front_slip_ratio',
      'rear_slip_ratio',
      'wheel_speed_rl',
      'mu_rear',
      'brake_temp_front',
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
      'pitot_dp_2',
      'cooling_air_dp',
      'strain_wing_pillar_l',
      'diff_temp',
      ...B1L_EXTRA_DISTRACTORS,
    ]),
  },
  defaultStrips: ['segment_time', 'speed', 'throttle', 'brake'],
  hintRules: [
    segmentPayingRule(),
    launchSpinRule({ withRamp: true }),
    wheelspinRule(),
    frontLockRule('under braking'),
    cornerGripLimitedRule(cornerIsPaying),
    dragCostRule(),
    pressureOffPeakRule(),
    rampTooGentleRule(),
    setupHeadroomRule(),
  ],
  conditions: DRY,
  passOn: 'any_run',
  scoreTarget: 'compromise_gap',
  segmentFloorSource: 'engine_optimum',
  surfaceLevers: ['wing', 'weight_dist'],
  debrief: {
    physics: [
      'Drag grows with v² and with the wing, so on a kilometre of straight a high wing costs time on every metre: `drag_force` caps `top_speed` long before the braking point.',
      'The same wing buys `downforce` and so `corner_min_speed` in one fast corner; the best single setup sits where the time the wing saves in the corner equals the time it costs on the straight, which is why `segment_delta` is shared out rather than zero, and with no stop to protect the fronts here, rear weight can take over the launch from the ramp: the same wheelspin, solved by a different lever.',
    ],
    causal: ['segment_delta', 'drag_force', 'top_speed', 'corner_min_speed', 'downforce'],
  },
};
