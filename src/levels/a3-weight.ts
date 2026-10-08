/**
 * A3 Weight (signal.md "A3, Weight"): launch, then brake to a stop at the end of the kilometre.
 * Static rear weight helps the launch and costs the stop. The player watches `load_front` and
 * `load_rear` trade places under acceleration and braking. `brake_temp_front` graduates from a
 * distractor to a correlated channel here (it now moves with the braking).
 *
 * Stage 11 (Fable finding 2): with the brake bias fixed at 70 % front the stop has two faults, one
 * either side of the optimum. Too little rear weight and the rears lock in the stop (and spin on
 * the launch); too much and the fronts lock. At the optimum (wd 0.44, ramp 0.2, 1.7 bar) neither
 * axle slides at any point, so the debrief's "neither slides" is what the model does. The
 * tolerance is 0.75 % so the tradeoff decides the pass: at otherwise optimal settings 3 of 8
 * weights pass (0.42, 0.44, 0.46), and at the default ramp 2 of 8.
 */
import { setupHeadroomRule } from '@/hints/headroom';
import type { HintCtx, HintRule } from '@/hints/types';
import type { LevelConfig } from './types';
import {
  AT_LIMIT,
  AXLE_FORCES,
  brakeWindow,
  carOf,
  DRY,
  FLAGS_GRIP,
  peakInPhase,
  pressureLever,
  rampLever,
  roles,
  SLIDING,
  TRACK_LAUNCH_STOP,
  weightLever,
} from './common';
import { pressureOffPeakRule } from './a2-grip';

type Summary = Parameters<HintRule['when']>[0];

/**
 * A lock is a fault when the axle slides for more than this fraction of the braking. Stage 6 had
 * 0.3, chosen so the rule stayed quiet at an optimum whose fronts locked for 1.3 s of a 4.7 s stop
 * (Fable finding 2: the rule was tuned around the model). With the Stage 11 brake balance the
 * A3 optimum locks neither axle at all, so the threshold only screens out a sample or two at the
 * very end of a stop; every real lock (0.8 s or more on A3) fires.
 */
export const LOCK_MIN_FRACTION = 0.05;

/** Weight can still move rearward (+1) or forward (−1) on this level. */
export function weightCanMove(ctx: HintCtx, dir: 1 | -1): boolean {
  const l = ctx.level.levers.find((x) => x.id === 'weight_dist');
  if (!l) return false;
  const v = ctx.setup.weight_dist;
  return dir > 0 ? v < l.max - 1e-9 : v > l.min + 1e-9;
}

/** Brake force shares in percent, from the level's car (the bias is fixed, not a lever). */
function biasVars(ctx: HintCtx): { front_pct: number; rear_pct: number } {
  const b = carOf(ctx.level).brakeBiasFront;
  return { front_pct: Math.round(b * 100), rear_pct: Math.round((1 - b) * 100) };
}

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
    when(s, ctx) {
      if (!weightCanMove(ctx, -1)) return null;
      const f = frontLock(s);
      if (!f) return null;
      return {
        ruleId: 'front_lock',
        vars: { peak: f.peak, t_start: f.tStart, t_end: f.tEnd, ...biasVars(ctx) },
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
      'Braking moves load forward: watch `load_front` climb and `load_rear` fall the moment the brakes go on. With {front_pct}% of the brake force on the front, the fronts lock when their load cannot carry it, and a locked tire stops the car less well than a gripping one.',
      `Move weight distribution toward the front until \`front_slip_ratio\` stays under 0.10 ${where}.`,
    ],
  };
}

/**
 * Fault: the rears spun on the launch, before any braking (A3, B1L and B4L): move weight rearward.
 *
 * Where the throttle ramp is free as well (B1L, B4L) the same wheelspin has two cures, a longer
 * ramp or more rear weight. `withRamp` makes the weight cure speak only when the data say rear
 * weight is affordable: the fronts did not lock in the braking, so the front axle has load to
 * give. It then ranks just above the ramp's `wheelspin` rule; otherwise `wheelspin` speaks alone.
 */
export function launchSpinRule(opts: { withRamp?: boolean } = {}): HintRule {
  const fires = (s: Summary, ctx: HintCtx) => {
    if (!weightCanMove(ctx, 1)) return null;
    if (opts.withRamp && frontSlide(s)) return null;
    return launchSpin(s);
  };
  return {
    id: 'launch_spin',
    kind: 'fault',
    when(s, ctx) {
      const l = fires(s, ctx);
      if (!l) return null;
      return {
        ruleId: 'launch_spin',
        vars: { peak: l.peak, t_start: l.tStart, t_end: l.tEnd },
        window: { channel: 'rear_slip_ratio', tStart: l.tStart, tEnd: l.tEnd },
        channels: ['rear_slip_ratio', 'load_rear', 'load_front'],
      };
    },
    estTimeCost(s, ctx) {
      const l = fires(s, ctx);
      // The wheelspin rule's estimate (same slide), plus a hair so the weight cure ranks first.
      return l ? 0.1 + 0.25 * (l.tEnd - l.tStart) + (opts.withRamp ? 0.01 : 0) : 0;
    },
    tiers: [
      '`rear_slip_ratio` peaked at {peak} on the launch, between {t_start:time} and {t_end:time}.',
      'Under acceleration load moves rearward, so `load_rear` rises above its static value and `load_front` falls; the rears grip in proportion to their load. With too little static weight on the rear, the driven tires run out of load before the launch is done and spin.',
      'Move weight distribution toward the rear until `rear_slip_ratio` stays under 0.10 on the launch.',
    ],
  };
}

/** Rear slide that overlaps braking for a real part of it, or null. */
function rearLock(s: Summary) {
  const brake = brakeWindow(s);
  if (!brake) return null;
  const peak = peakInPhase(s, 'rear_slip_ratio', brake.tStart, true);
  if (!SLIDING(peak)) return null;
  const w = s.window('rear_slip_ratio', SLIDING);
  if (!w || w.tEnd < brake.tStart) return null;
  const tStart = Math.max(w.tStart, brake.tStart);
  const frac = (w.tEnd - tStart) / Math.max(1e-6, brake.tEnd - brake.tStart);
  return frac > LOCK_MIN_FRACTION ? { tStart, tEnd: w.tEnd, peak } : null;
}

/**
 * Fault (Stage 11): the rears locked under braking (A3, B4L). The brake bias is fixed, so the
 * lever is the weight split: more static rear weight keeps the rears loaded in the stop.
 */
export function rearLockRule(): HintRule {
  return {
    id: 'rear_lock',
    kind: 'fault',
    when(s, ctx) {
      if (!weightCanMove(ctx, 1)) return null;
      const l = rearLock(s);
      if (!l) return null;
      return {
        ruleId: 'rear_lock',
        vars: { peak: l.peak, t_start: l.tStart, t_end: l.tEnd, ...biasVars(ctx) },
        window: { channel: 'rear_slip_ratio', tStart: l.tStart, tEnd: l.tEnd },
        channels: ['rear_slip_ratio', 'load_rear', 'load_front'],
      };
    },
    estTimeCost(s) {
      const l = rearLock(s);
      return l ? 0.05 + 0.3 * (l.tEnd - l.tStart) : 0;
    },
    tiers: [
      '`rear_slip_ratio` peaked at {peak} under braking, between {t_start:time} and {t_end:time}: the rears locked.',
      'Braking moves load off the rears: `load_rear` falls the moment the brakes go on. The brake bias is fixed with {rear_pct}% of the force on the rear, so when too little static weight sits there the rears run out of load before the fronts and lock.',
      'Move weight distribution toward the rear until `rear_slip_ratio` stays under 0.10 in the stop.',
    ],
  };
}

/** Headroom: nothing slid and the fronts had grip to spare in the braking (shared by A3 and B4L). */
export function transferHeadroomRule(): HintRule {
  return {
    id: 'transfer_headroom',
    kind: 'headroom',
    when(s, ctx) {
      if (!weightCanMove(ctx, 1)) return null;
      if (launchSpin(s) || frontLock(s) || rearLock(s)) return null;
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
    'The car launches, then brakes to a stop exactly at the end of the kilometre. Weight distribution sets how much static load sits on the rear axle; acceleration moves load rearward and braking moves it forward. Brake bias is fixed at 70% front, so the stop wants the axles loaded in step with it. Find the split that serves both the launch and the stop.',
  track: TRACK_LAUNCH_STOP,
  flags: FLAGS_GRIP,
  // Stage 11: the run starts with the rear weight high (a clean launch, locking fronts).
  levers: [rampLever(0.4), pressureLever(1.7), weightLever(0.5)],
  lockedLevers: { wing: 4 },
  runBudget: 6,
  // Stage 11: 0.75 % (the spec's 1 % let 4 of 8 weights pass at otherwise optimal settings).
  tolerance: 0.0075,
  hintCost: [1, 1, 1],
  channelSet: [
    ...AXLE_FORCES,
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
    ...roles('correlated', AXLE_FORCES),
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
  hintRules: [
    frontLockRule(),
    rearLockRule(),
    launchSpinRule(),
    transferHeadroomRule(),
    pressureOffPeakRule(),
    setupHeadroomRule(),
  ],
  conditions: DRY,
  passOn: 'any_run',
  scoreTarget: 'time',
  debrief: {
    physics: [
      'Acceleration moves load onto the rear axle and braking moves it onto the front, by m·a·h/L, so `load_front` and `load_rear` cross every time the car changes from driving to braking.',
      'Static rear weight feeds the driven tires on the launch, but with the brake bias fixed too much of it locks the fronts in the stop and too little locks the rears; the fastest split sits inside the range, where neither the launch nor the stop slides, and the extra rear weight that would let a shorter ramp launch cleanly is the weight that locks the fronts.',
    ],
    causal: ['load_front', 'load_rear', 'front_slip_ratio', 'rear_slip_ratio'],
  },
};
