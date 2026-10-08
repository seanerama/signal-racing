/**
 * A3 Weight (signal.md "A3, Weight"): launch, then brake to a stop at the end of the kilometre.
 * Static rear weight helps the launch and costs the stop. The player watches `load_front` and
 * `load_rear` trade places under acceleration and braking. `brake_temp_front` graduates from a
 * distractor to a correlated channel here (it now moves with the braking).
 */
import type { HintRule } from '@/hints/types';
import type { LevelConfig } from './types';
import {
  AT_LIMIT,
  DRY,
  FLAGS_GRIP,
  TRACK_LAUNCH_STOP,
  brakeWindow,
  peakInPhase,
  pressureLever,
  rampLever,
  roles,
  SLIDING,
  weightLever,
} from './common';
import { pressureOffPeakRule } from './a2-grip';

type Summary = Parameters<HintRule['when']>[0];

/**
 * A front lock is a fault when the fronts slide for more than this fraction of the stop. Shorter
 * locks happen in the last part of the stop, as speed and aero load run out together, and cost
 * less than the launch gains from the rear weight that causes them (Stage 6 grid data: at the
 * optimum the fronts slide for at most about a quarter of the stop).
 */
export const LOCK_MIN_FRACTION = 0.3;

/** Front slip window (above the peak-grip slip) that overlaps braking, or null. */
function frontSlide(s: Summary) {
  const brake = brakeWindow(s);
  if (!brake) return null;
  const w = s.window('front_slip_ratio', SLIDING);
  if (!w || w.tEnd < brake.tStart) return null;
  const tStart = Math.max(w.tStart, brake.tStart);
  const frac = (w.tEnd - tStart) / Math.max(1e-6, brake.tEnd - brake.tStart);
  return { brake, tStart, tEnd: w.tEnd, frac };
}

/** A front lock that covers a real part of the stop, or null. */
function frontLock(s: Summary) {
  const f = frontSlide(s);
  if (!f || !(f.frac > LOCK_MIN_FRACTION)) return null;
  return { ...f, peak: peakInPhase(s, 'front_slip_ratio', f.brake.tStart, true) };
}

/** Rear slip window (above the peak-grip slip) that starts before braking, or null. */
function launchSpin(s: Summary) {
  const brake = brakeWindow(s);
  const cut = brake ? brake.tStart : Infinity;
  const w = s.window('rear_slip_ratio', SLIDING);
  if (!w || w.tStart >= cut) return null;
  // The window's end may run into braking lock; clip it to the launch phase.
  const tEnd = Math.min(w.tEnd, cut);
  const peak = Number.isFinite(cut)
    ? peakInPhase(s, 'rear_slip_ratio', cut)
    : (s.clean.rear_slip_ratio?.max ?? NaN);
  return { tStart: w.tStart, tEnd, peak };
}

/**
 * Fault: the fronts locked for a real part of the braking (shared by A3, B1L and B4L). `where`
 * finishes tier 3: "in the stop" on A3, "under braking" where the braking is into a corner.
 */
export function frontLockRule(where = 'in the stop'): HintRule {
  return {
    id: 'front_lock',
    kind: 'fault',
    when(s) {
      const f = frontLock(s);
      if (!f) return null;
      return {
        ruleId: 'front_lock',
        vars: { peak: f.peak, t_start: f.tStart, t_end: f.tEnd },
        window: { channel: 'front_slip_ratio', tStart: f.tStart, tEnd: f.tEnd },
        channels: ['front_slip_ratio', 'load_front', 'load_rear'],
      };
    },
    estTimeCost(s) {
      const f = frontLock(s);
      return f ? 0.05 + 0.3 * (f.tEnd - f.tStart) : 0;
    },
    tiers: [
      '`front_slip_ratio` peaked at {peak} under braking, between {t_start:time} and {t_end:time}.',
      'Braking moves load forward: watch `load_front` climb and `load_rear` fall the moment the brakes go on. With 60% of the brake force on the front, the fronts lock when their load cannot carry it, and a locked tire stops the car less well than a gripping one.',
      `Move weight distribution toward the front until \`front_slip_ratio\` stays under 0.10 ${where}.`,
    ],
  };
}

/** Fault: the rears spun on the launch, before any braking (shared by A3 and B4L). */
export function launchSpinRule(): HintRule {
  return {
    id: 'launch_spin',
    kind: 'fault',
    when(s) {
      const l = launchSpin(s);
      if (!l) return null;
      return {
        ruleId: 'launch_spin',
        vars: { peak: l.peak, t_start: l.tStart, t_end: l.tEnd },
        window: { channel: 'rear_slip_ratio', tStart: l.tStart, tEnd: l.tEnd },
        channels: ['rear_slip_ratio', 'load_rear', 'load_front'],
      };
    },
    estTimeCost(s) {
      const l = launchSpin(s);
      return l ? 0.1 + 0.25 * (l.tEnd - l.tStart) : 0;
    },
    tiers: [
      '`rear_slip_ratio` peaked at {peak} on the launch, between {t_start:time} and {t_end:time}.',
      'Under acceleration load moves rearward, so `load_rear` rises above its static value and `load_front` falls; the rears grip in proportion to their load. With too little static weight on the rear, the driven tires run out of load before the launch is done and spin.',
      'Move weight distribution toward the rear until `rear_slip_ratio` stays under 0.10 on the launch.',
    ],
  };
}

/** Headroom: nothing slid and the fronts had grip to spare in the braking (shared by A3 and B4L). */
export function transferHeadroomRule(): HintRule {
  return {
    id: 'transfer_headroom',
    kind: 'headroom',
    when(s) {
      if (launchSpin(s) || frontLock(s)) return null;
      const brake = brakeWindow(s);
      if (!brake) return null;
      const used = peakInPhase(s, 'grip_used_front', brake.tStart, true);
      if (!(used < AT_LIMIT)) return null;
      return {
        ruleId: 'transfer_headroom',
        vars: { used_pct: Math.round(used * 100), load: s.clean.load_front?.max ?? NaN },
        window: { channel: 'load_front', tStart: brake.tStart, tEnd: brake.tEnd },
        channels: ['load_front', 'grip_used_front', 'load_rear'],
      };
    },
    estTimeCost: () => 0.05,
    tiers: [
      '`load_front` peaked at {load:force} in the stop and the fronts never used more than {used_pct}% of their grip: the stop had grip to spare.',
      'Load the front axle does not need in the stop is load the rear could have used on the launch. Static weight moves the whole `load_rear` line up or down; braking transfer then moves load forward on top of it.',
      'Move weight distribution toward the rear until the fronts just reach their limit in the stop.',
    ],
  };
}

export const A3: LevelConfig = {
  id: 'A3',
  configVersion: 1,
  phase: 'A',
  title: 'Weight',
  concept: 'Longitudinal load transfer',
  brief:
    'The car launches, then brakes to a stop exactly at the end of the kilometre. Weight distribution sets how much static load sits on the rear axle; acceleration moves load rearward and braking moves it forward. Brake bias is fixed at 60% front. Find the split that serves both the launch and the stop.',
  track: TRACK_LAUNCH_STOP,
  flags: FLAGS_GRIP,
  levers: [rampLever(0.4), pressureLever(1.7), weightLever(0.4)],
  lockedLevers: { wing: 4 },
  runBudget: 6,
  tolerance: 0.01,
  hintCost: [1, 1, 1],
  channelSet: [
    'segment_time',
    'delta_best',
    'top_speed',
    'load_front',
    'load_rear',
    'front_slip_ratio',
    'rear_slip_ratio',
    'speed',
    'long_g',
    'throttle',
    'brake',
    'engine_rpm',
    'gear',
    'wheel_speed_fl',
    'wheel_speed_rl',
    'grip_used_front',
    'grip_used_rear',
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
  ],
  channelRoles: {
    ...roles('outcome', ['segment_time', 'delta_best', 'top_speed']),
    ...roles('causal', ['load_front', 'load_rear', 'front_slip_ratio', 'rear_slip_ratio']),
    ...roles('correlated', [
      'speed',
      'long_g',
      'throttle',
      'brake',
      'engine_rpm',
      'gear',
      'wheel_speed_fl',
      'wheel_speed_rl',
      'grip_used_front',
      'grip_used_rear',
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
    ]),
  },
  defaultStrips: ['segment_time', 'speed', 'long_g', 'throttle', 'brake'],
  hintRules: [frontLockRule(), launchSpinRule(), transferHeadroomRule(), pressureOffPeakRule()],
  conditions: DRY,
  passOn: 'any_run',
  scoreTarget: 'time',
  debrief: {
    physics: [
      'Acceleration moves load onto the rear axle and braking moves it onto the front, by m·a·h/L, so `load_front` and `load_rear` cross every time the car changes from driving to braking.',
      'Static rear weight feeds the driven tires on the launch but starves the fronts in the stop; the fastest split sits inside the range, where neither end of the run slides.',
    ],
    causal: ['load_front', 'load_rear', 'front_slip_ratio', 'rear_slip_ratio'],
  },
};
