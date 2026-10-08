/**
 * A2 Grip (signal.md "A2, Grip"): the same straight with the traction limit on. The A1 answer (no
 * ramp) now spins the rears; pressure sets μ on a bell. The discovery is `wheel_speed_rl` leaving
 * `speed` at the same instant `rear_slip_ratio` spikes.
 *
 * Direction note: in this engine a LONGER ramp reduces wheelspin, so tier 3 says "Lengthen".
 */
import type { HintCtx, HintRule } from '@/hints/types';
import type { RunSummary } from '@/telemetry/types';
import { setupHeadroomRule } from '@/hints/headroom';
import type { LevelConfig } from './types';
import {
  AXLE_FORCES,
  brakeWindow,
  cleanMax,
  DRY,
  FLAGS_GRIP,
  lever,
  peakInPhase,
  pressureDirection,
  pressureGripRatio,
  pressureLever,
  rampLever,
  rampWindow,
  roles,
  slidingWindow,
  TRACK_STRAIGHT,
  type Window,
} from './common';

/** μ below this fraction of μ at the optimum pressure counts as off-peak. */
export const PRESSURE_RATIO_MIN = 0.99;
/** Grip used at or above this counts as "the rears were at their limit". */
export const LIMIT_REACHED = 0.99;
/** The ramp counts as too gentle when it is longer than this many lever steps. */
export const RAMP_SLACK_STEPS = 1.5;

/**
 * The rear slide that counts as wheelspin: one that starts under drive, before the first brake
 * application. `rear_slip_ratio` is unsigned, so a rear lock under braking (B4L's stop) also reads
 * above the peak; that is not wheelspin and the ramp cannot cure it.
 */
export function driveSlide(s: RunSummary): Window | null {
  const w = slidingWindow(s, 'rear_slip_ratio');
  if (!w) return null;
  const brake = brakeWindow(s);
  if (brake && w.tStart >= brake.tStart) return null;
  return brake ? { tStart: w.tStart, tEnd: Math.min(w.tEnd, brake.tStart) } : w;
}

/** Peak rear slip under drive: before the first brake application (the whole run without braking). */
export function drivePeakSlip(s: RunSummary): number {
  const brake = brakeWindow(s);
  return brake ? peakInPhase(s, 'rear_slip_ratio', brake.tStart) : cleanMax(s, 'rear_slip_ratio');
}

/**
 * Pressure is the lever this run: it is unlocked and off the top of its bell. A slide on such a
 * run is the tires' doing as much as the ramp's, and a longer ramp only delays the same spin
 * (Fable finding 3: following "lengthen the ramp" at 1.9 bar made the next run slower), so the
 * ramp rules defer to the pressure rule.
 */
export function pressureIsTheLever(ctx: HintCtx): boolean {
  return (
    ctx.level.levers.some((l) => l.id === 'tire_pressure') &&
    pressureGripRatio(ctx) < PRESSURE_RATIO_MIN
  );
}

/** Fault: the driven tires slid under drive (shared by A2, A4, B1L and B4L). */
export function wheelspinRule(): HintRule {
  return {
    id: 'wheelspin',
    kind: 'fault',
    when(s, ctx) {
      if (pressureIsTheLever(ctx)) return null;
      const w = driveSlide(s);
      if (!w) return null;
      return {
        ruleId: 'wheelspin',
        vars: { peak: cleanMax(s, 'rear_slip_ratio'), t_start: w.tStart, t_end: w.tEnd },
        window: { channel: 'rear_slip_ratio', ...w },
        channels: ['rear_slip_ratio', 'wheel_speed_rl', 'speed'],
      };
    },
    estTimeCost(s) {
      const w = driveSlide(s);
      return w ? 0.1 + 0.25 * (w.tEnd - w.tStart) : 0;
    },
    tiers: [
      '`rear_slip_ratio` peaked at {peak} between {t_start:time} and {t_end:time}.',
      'Slip ratio above about 0.10 means the driven tires are spinning faster than the car is moving: `wheel_speed_rl` runs ahead of `speed`. Sliding rubber makes less force than gripping rubber, and once it starts sliding it keeps sliding until the driver asks for less, so an over-eager launch costs far more than the moment it happens in.',
      'Lengthen the throttle ramp until peak slip ratio stays under 0.10.',
    ],
  };
}

/**
 * Headroom: pressure off the μ peak on a run where the rears ran out of grip (they slid, or used
 * all of it). Where the rears never reach their limit, pressure costs nothing and the rule stays
 * quiet. Shared by A2, A3 and A4.
 */
export function pressureOffPeakRule(): HintRule {
  const limited = (s: RunSummary): Window | null =>
    slidingWindow(s, 'rear_slip_ratio') ?? s.window('grip_used_rear', (v) => v >= LIMIT_REACHED);
  return {
    id: 'pressure_off_peak',
    kind: 'headroom',
    when(s, ctx) {
      const ratio = pressureGripRatio(ctx);
      if (!(ratio < PRESSURE_RATIO_MIN)) return null;
      const w = limited(s);
      if (!w) return null;
      return {
        ruleId: 'pressure_off_peak',
        vars: {
          mu: s.clean.mu_rear?.max ?? NaN,
          dir: pressureDirection(ctx) > 0 ? 'Lower' : 'Raise',
        },
        window: { channel: 'mu_rear', ...w },
        channels: ['mu_rear', 'grip_used_rear', 'rear_slip_ratio'],
      };
    },
    estTimeCost(s, ctx) {
      const base = 0.6 * (1 - pressureGripRatio(ctx)) * ctx.outcome.totalTime;
      // A slide that starts only after the throttle is already full is not the ramp's doing:
      // pressure is then the lever that matters, so rank this above the wheelspin rule.
      const slide = slidingWindow(s, 'rear_slip_ratio');
      const ramp = rampWindow(s);
      const afterRamp = !!slide && !!ramp && ramp.tEnd > 0 && slide.tStart >= ramp.tEnd - 0.05;
      return base + (afterRamp ? 1 : 0);
    },
    tiers: [
      '`mu_rear` never got above {mu}, and the rears ran out of grip: `rear_slip_ratio` and `grip_used_rear` show where.',
      'Tire pressure sets the friction coefficient on a bell curve: too soft or too hard and μ falls on both sides of the peak. The force the rears can put down is μ times load, so a tire off its peak spins at a throttle a tire on its peak would take.',
      '{dir} the tire pressure until `mu_rear` stops rising.',
    ],
  };
}

/**
 * Headroom: nothing slid, and `long_g` peaked only when the throttle reached full, so the ramp,
 * not the tires, limited the launch, and a shorter ramp setting exists. Shared by A2.
 */
export function rampTooGentleRule(): HintRule {
  const gentle = (s: RunSummary, step: number): Window | null => {
    if (driveSlide(s)) return null;
    const ramp = rampWindow(s);
    const lg = s.clean.long_g;
    if (!ramp || !lg) return null;
    // Ramp-limited: acceleration is still climbing when the throttle reaches full.
    if (!(lg.tMax >= ramp.tEnd - 0.05)) return null;
    if (!(ramp.tEnd > RAMP_SLACK_STEPS * step)) return null;
    return ramp;
  };
  return {
    id: 'ramp_too_gentle',
    kind: 'headroom',
    when(s, ctx) {
      // Off the pressure peak, a shorter ramp only spins sooner: pressure first.
      if (pressureIsTheLever(ctx)) return null;
      const ramp = gentle(s, lever(ctx.level, 'throttle_ramp').step);
      if (!ramp) return null;
      return {
        ruleId: 'ramp_too_gentle',
        vars: { t_full: ramp.tEnd, slip: drivePeakSlip(s) },
        window: { channel: 'long_g', tStart: 0, tEnd: ramp.tEnd },
        channels: ['long_g', 'throttle', 'rear_slip_ratio'],
      };
    },
    estTimeCost(s, ctx) {
      const ramp = gentle(s, lever(ctx.level, 'throttle_ramp').step);
      return ramp ? ramp.tEnd * 0.25 : 0;
    },
    tiers: [
      '`long_g` kept climbing for {t_full:time}, until `throttle` reached full, and `rear_slip_ratio` never got past {slip}.',
      'A slip ratio below the peak-grip slip means the rears had grip to spare: acceleration was limited by the throttle, not the tires. Part throttle on a launch that is not at the traction limit is acceleration left on the table.',
      'Shorten the throttle ramp until `rear_slip_ratio` just reaches its peak without passing it.',
    ],
  };
}

export const A2: LevelConfig = {
  id: 'A2',
  configVersion: 1,
  phase: 'A',
  title: 'Grip',
  concept: 'Traction limit',
  brief:
    'The same straight, but now the rear tires have a grip limit, and tire pressure sets how much grip they have. The launch that won A1 may no longer be the fastest. Find the ramp and pressure that put the most force into the road, and look past the strips you start with.',
  track: TRACK_STRAIGHT,
  flags: FLAGS_GRIP,
  levers: [rampLever(0), pressureLever(1.9)],
  lockedLevers: { weight_dist: 0.45, wing: 4 },
  runBudget: 6,
  tolerance: 0.01,
  hintCost: [1, 1, 1],
  channelSet: [
    ...AXLE_FORCES,
    'segment_time',
    'delta_best',
    'top_speed',
    'speed',
    'long_g',
    'throttle',
    'engine_rpm',
    'gear',
    'drag_force',
    'wheel_speed_fl',
    'grip_used_rear',
    'rear_slip_ratio',
    'speed_diff_rl',
    'wheel_speed_rl',
    'mu_rear',
    'oil_temp',
    'water_temp',
    'gearbox_temp',
    'battery_voltage',
    'intake_air_temp',
    'fuel_pressure',
  ],
  channelRoles: {
    ...roles('correlated', AXLE_FORCES),
    ...roles('outcome', ['segment_time', 'delta_best', 'top_speed']),
    // Stage 11: `grip_used_rear` is causal too (the pressure rule reads it): 5 of 25, 1 in 5.
    ...roles('causal', [
      'rear_slip_ratio',
      'speed_diff_rl',
      'wheel_speed_rl',
      'mu_rear',
      'grip_used_rear',
    ]),
    ...roles('correlated', [
      'speed',
      'long_g',
      'throttle',
      'engine_rpm',
      'gear',
      'drag_force',
      'wheel_speed_fl',
    ]),
    ...roles('distractor', [
      'oil_temp',
      'water_temp',
      'gearbox_temp',
      'battery_voltage',
      'intake_air_temp',
      'fuel_pressure',
    ]),
  },
  defaultStrips: ['segment_time', 'speed', 'throttle', 'engine_rpm', 'gear'],
  hintRules: [wheelspinRule(), pressureOffPeakRule(), rampTooGentleRule(), setupHeadroomRule()],
  conditions: DRY,
  passOn: 'any_run',
  scoreTarget: 'time',
  debrief: {
    physics: [
      'A tire can push only μ times its load; ask for more and it slides, slip ratio climbs past about 0.10 and the force drops to a fraction of its peak.',
      'The fastest launch ramps in just slowly enough that `rear_slip_ratio` never passes its peak, on a pressure that keeps `mu_rear` at the top of its bell.',
    ],
    causal: ['rear_slip_ratio', 'speed_diff_rl', 'wheel_speed_rl', 'mu_rear', 'grip_used_rear'],
  },
};
