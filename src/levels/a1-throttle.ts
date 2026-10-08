/**
 * A1 Throttle (signal.md "A1, Throttle"): a tutorial on reading the stack. Unlimited grip, so the
 * fastest ramp is always best; the lesson is the graphs. Defaults deliberately leave out the
 * causal `speed`, `long_g` and `drag_force`: the brief tells the player to pull them in from the
 * table, which is the core move of the game.
 */
import type { LevelConfig } from './types';
import {
  AXLE_FORCES,
  DRY,
  FLAGS_NO_GRIP_LIMIT,
  rampLever,
  rampWindow,
  roles,
  TRACK_STRAIGHT,
} from './common';

/** Throttle counts as "already full" when it reaches 1.0 within this time (s). */
const RAMP_GRACE = 0.05;

export const A1: LevelConfig = {
  id: 'A1',
  configVersion: 1,
  phase: 'A',
  title: 'Throttle',
  concept: 'Drag, F = ma',
  brief:
    'A kilometre of straight from a standing start, with unlimited grip. The table on the right lists every channel; clicking one pulls it into the stack, and that is how you read it. Pull in `speed`, `long_g` and `drag_force`, then set the throttle ramp and run.',
  track: TRACK_STRAIGHT,
  flags: FLAGS_NO_GRIP_LIMIT,
  levers: [rampLever(1.0)],
  lockedLevers: { tire_pressure: 1.65, weight_dist: 0.45, wing: 4 },
  runBudget: 5,
  tolerance: 0.01,
  hintCost: [1, 1, 1],
  channelSet: [
    ...AXLE_FORCES,
    'segment_time',
    'delta_best',
    'speed',
    'long_g',
    'drag_force',
    'throttle',
    'engine_rpm',
    'gear',
    'engine_force',
    'oil_temp',
    'water_temp',
    'battery_voltage',
  ],
  channelRoles: {
    ...roles('correlated', AXLE_FORCES),
    ...roles('outcome', ['segment_time', 'delta_best']),
    ...roles('causal', ['speed', 'long_g', 'drag_force']),
    ...roles('correlated', ['throttle', 'engine_rpm', 'gear', 'engine_force']),
    ...roles('distractor', ['oil_temp', 'water_temp', 'battery_voltage']),
  },
  defaultStrips: ['segment_time', 'throttle', 'engine_rpm', 'gear'],
  hintRules: [
    {
      id: 'ramp_headroom',
      kind: 'headroom',
      when(s) {
        const ramp = rampWindow(s);
        if (!ramp || !(ramp.tEnd > RAMP_GRACE)) return null;
        return {
          ruleId: 'ramp_headroom',
          vars: { t_full: ramp.tEnd, long_g_peak: s.clean.long_g?.max ?? NaN },
          window: { channel: 'long_g', tStart: 0, tEnd: ramp.tEnd },
          channels: ['throttle', 'long_g'],
        };
      },
      estTimeCost(s) {
        const ramp = rampWindow(s);
        return ramp ? ramp.tEnd / 2 : 0;
      },
      tiers: [
        '`throttle` took {t_full:time} to reach full, and `long_g` stayed below its peak of {long_g_peak:accel_g} for that whole time.',
        'With unlimited grip nothing limits the force but the engine, and acceleration is force over mass. Every moment at part throttle is speed the car never gets back.',
        'Shorten the throttle ramp.',
      ],
    },
    {
      id: 'drag_bend',
      kind: 'headroom',
      // Informational: fires on the first run of a session (no best yet) to teach the reading.
      when(s, ctx) {
        if (ctx.bestOutcome) return null;
        const drag = s.clean.drag_force;
        const speed = s.clean.speed;
        if (!drag || !speed) return null;
        return {
          ruleId: 'drag_bend',
          vars: { drag: drag.max, vmax: speed.max, lg: s.clean.long_g?.min ?? NaN },
          window: { channel: 'drag_force', tStart: 0, tEnd: drag.tMax },
          channels: ['drag_force', 'speed', 'long_g'],
        };
      },
      estTimeCost: () => 0.001,
      tiers: [
        '`drag_force` climbed to {drag:force} at {vmax:speed}, bending upward as `speed` rose.',
        'Drag grows with the square of speed: twice the speed costs four times the force. As drag eats more of the engine force, less is left to accelerate the car, which is why `long_g` falls as `speed` rises.',
        'Shorten the throttle ramp and let the car reach full power sooner; drag itself is set by speed, not by the ramp.',
      ],
    },
  ],
  conditions: DRY,
  passOn: 'any_run',
  scoreTarget: 'time',
  debrief: {
    physics: [
      'Acceleration is engine force minus drag, divided by mass, and drag grows with the square of speed, so `long_g` falls as `speed` rises.',
      'With unlimited grip the fastest throttle ramp is no ramp at all: any time at part throttle is acceleration lost.',
    ],
    causal: ['speed', 'long_g', 'drag_force'],
  },
};
