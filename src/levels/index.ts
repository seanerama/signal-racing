/**
 * TEMPORARY STUB (Stage 5). One minimal level so the game core (worker, grid search, session,
 * hints) is testable end to end. Stage 6 replaces this file with the real A1–A4 content.
 */
import type { LevelConfig } from './types';

/** Stub A2: 1 km standing start, traction and pressure on, ramp + pressure unlocked. */
export const STUB_A2: LevelConfig = {
  id: 'A2',
  configVersion: 0,
  phase: 'A',
  title: 'Grip (stub)',
  concept: 'Traction limit',
  brief:
    'Stage 5 stub level. The rear tires can only push so hard. Find the launch that uses all of it.',
  track: {
    id: 'a2',
    standingStart: true,
    laps: 1,
    segments: [{ id: 'launch', label: 'Launch', kind: 'straight', length: 1000 }],
  },
  flags: { tractionLimit: true, pressureAffectsGrip: true, tempAffectsGrip: false },
  levers: [
    {
      id: 'throttle_ramp',
      label: 'Throttle ramp',
      quantity: 'time',
      min: 0,
      max: 1.5,
      step: 0.1,
      default: 0,
    },
    {
      id: 'tire_pressure',
      label: 'Tire pressure',
      quantity: 'pressure',
      min: 1.2,
      max: 2.2,
      step: 0.1,
      default: 1.9,
    },
  ],
  lockedLevers: { weight_dist: 0.45, wing: 4 },
  runBudget: 6,
  tolerance: 0.01,
  hintCost: [1, 1, 1],
  channelSet: [
    'segment_time',
    'speed',
    'throttle',
    'engine_rpm',
    'gear',
    'long_g',
    'top_speed',
    'delta_best',
    'rear_slip_ratio',
    'front_slip_ratio',
    'speed_diff_rl',
    'wheel_speed_rl',
    'wheel_speed_rr',
    'mu_rear',
    'load_rear',
    'oil_temp',
    'water_temp',
    'gearbox_temp',
    'battery_voltage',
    'intake_air_temp',
  ],
  channelRoles: {
    segment_time: 'outcome',
    delta_best: 'outcome',
    top_speed: 'outcome',
    speed: 'correlated',
    throttle: 'correlated',
    engine_rpm: 'correlated',
    gear: 'correlated',
    long_g: 'correlated',
    front_slip_ratio: 'correlated',
    wheel_speed_rr: 'correlated',
    load_rear: 'correlated',
    rear_slip_ratio: 'causal',
    speed_diff_rl: 'causal',
    wheel_speed_rl: 'causal',
    mu_rear: 'causal',
    oil_temp: 'distractor',
    water_temp: 'distractor',
    gearbox_temp: 'distractor',
    battery_voltage: 'distractor',
    intake_air_temp: 'distractor',
  },
  defaultStrips: ['segment_time', 'speed', 'throttle', 'engine_rpm', 'gear'],
  hintRules: [
    {
      id: 'wheelspin',
      kind: 'fault',
      when(s) {
        const slip = s.clean.rear_slip_ratio;
        if (!slip || !(slip.max > 0.1)) return null;
        const w = s.window('rear_slip_ratio', (v) => v > 0.1);
        return {
          ruleId: 'wheelspin',
          vars: { peak: slip.max, t_start: w?.tStart ?? 0, t_end: w?.tEnd ?? 0 },
          ...(w ? { window: { channel: 'rear_slip_ratio', ...w } } : {}),
          channels: ['rear_slip_ratio', 'speed_diff_rl'],
        };
      },
      estTimeCost(s) {
        const w = s.window('rear_slip_ratio', (v) => v > 0.1);
        return w ? 0.2 * (w.tEnd - w.tStart) : 0;
      },
      tiers: [
        '`rear_slip_ratio` peaked at {peak} between {t_start:time} and {t_end:time}.',
        'Slip ratio above about 0.10 means the driven tires spin faster than the car moves. Sliding rubber makes less force than gripping rubber.',
        'Lengthen the throttle ramp until peak slip ratio stays under the peak-grip slip.',
      ],
    },
  ],
  conditions: { base: { trackTemp: 30, ambientTemp: 20, gripMultiplier: 1 } },
  passOn: 'any_run',
  scoreTarget: 'time',
  debrief: {
    physics: [
      'The rear tires can transmit only μ·N of force.',
      'Above that they slide and the car accelerates less, not more.',
    ],
    causal: ['rear_slip_ratio', 'speed_diff_rl'],
  },
};

/** Levels in unlock order. */
export const LEVELS: readonly LevelConfig[] = [STUB_A2];

export function getLevel(id: string): LevelConfig | undefined {
  return LEVELS.find((l) => l.id === id);
}
