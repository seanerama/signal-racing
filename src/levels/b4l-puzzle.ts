/**
 * B4L "The Puzzle" (signal.md "The Puzzle and the AI assist"; meeting-cut lite). Every team
 * arrives with data and limited practice time; the question is who puts the puzzle together
 * fastest. An open circuit (main straight, fast right, back straight, hairpin, run to a stop),
 * all four levers, conditions that vary between runs, ten runs, and the whole channel registry
 * (~215 channels) of which eight are causal (1 in 27).
 *
 * Deliberately absent (M2/M3): anti-roll bars, tire temperature, fuel and wear. With one fixed
 * roll-stiffness split, the fast corner and the hairpin cannot be balanced separately yet.
 *
 * Hint rules: the union of A2, A3, A4 and B1L, plus the noise rule and the generic headroom rule.
 * Stage 11 restores A3's `launch_spin` (in its `withRamp` form): a launch slide names the weight
 * cure when the fronts have braking load to give, and the ramp cure (`wheelspin`) when they lock,
 * so the A2 ramp and the A3 weight meet here as one wheelspin with two levers.
 *
 * `oil_temp` is in the default stack on purpose: it is plausible, it moves, and it explains
 * nothing.
 */
import { noiseRule } from '@/hints/engine';
import { setupHeadroomRule } from '@/hints/headroom';
import { allChannels } from '@/telemetry/registry';
import type { Role } from '@/telemetry/types';
import type { ChannelId } from '@/engine/types';
import type { LevelConfig } from './types';
import {
  DRY,
  FLAGS_GRIP,
  TRACK_PUZZLE,
  pressureLever,
  rampLever,
  weightLever,
  wingLever,
} from './common';
import { pressureOffPeakRule, rampTooGentleRule, wheelspinRule } from './a2-grip';
import { frontLockRule, launchSpinRule, rearLockRule, transferHeadroomRule } from './a3-weight';
import { cornerGripLimitedRule, dragCostRule } from './a4-corner';
import { cornerIsPaying, segmentPayingRule } from './b1l-join';

const OUTCOME: ChannelId[] = ['segment_time', 'delta_best', 'top_speed'];
/**
 * Stage 11: the channels the earlier levels taught, 8 of ~215. The axle forces (Stage 9) feed the
 * grip circle and are correlated here, not causal (signal-to-noise, finding 6).
 */
export const B4L_CAUSAL: ChannelId[] = [
  'rear_slip_ratio',
  'front_slip_ratio',
  'load_front',
  'load_rear',
  'drag_force',
  'speed_diff_rl',
  'mu_rear',
  'segment_delta',
];

/** m: where run 2's planted `speed_diff_rl` spike sits (mid main straight, no wheelspin). */
export const SPIKE_AT_M = 612;

/** Every registry channel, in registry order. */
const ALL: ChannelId[] = allChannels().map((c) => c.id);

function roleOf(id: ChannelId): Role {
  if (OUTCOME.includes(id)) return 'outcome';
  if (B4L_CAUSAL.includes(id)) return 'causal';
  return allChannels().find((c) => c.id === id)?.source.kind === 'distractor'
    ? 'distractor'
    : 'correlated';
}

export const B4L: LevelConfig = {
  id: 'B4L',
  configVersion: 1,
  phase: 'B',
  title: 'The Puzzle',
  concept: 'Everything, plus the assist',
  brief:
    'The assembled track: the straight and fast corner from the join, a back straight, a hairpin and a run to a stop, with grip and track temperature moving a little every run (`grip_multiplier` and `track_temp` log them). Every lever is open and about two hundred channels move, of which a handful matter; the stop is back, so the rear weight that cures a launch spin now costs the fronts in the braking. The assist toggle at the top of the channel table ranks channels against lap time once you have three runs: a filter, not a decider.',
  track: TRACK_PUZZLE,
  flags: FLAGS_GRIP,
  // Stage 11: a puzzle start, one fault per earlier lesson: pressure off its peak (A2), no ramp
  // (the launch spins, and with the fronts locking in the stop the ramp is the cheaper cure: A3),
  // and the A4 wing on a track with two long straights (B1).
  levers: [rampLever(0), pressureLever(1.8), weightLever(0.46), wingLever(7)],
  lockedLevers: {},
  runBudget: 10,
  tolerance: 0.005,
  hintCost: [1, 1, 1],
  channelSet: ALL,
  channelRoles: Object.fromEntries(ALL.map((id) => [id, roleOf(id)])),
  defaultStrips: ['segment_time', 'speed', 'throttle', 'engine_rpm', 'gear', 'oil_temp'],
  hintRules: [
    segmentPayingRule(),
    launchSpinRule({ withRamp: true }),
    wheelspinRule(),
    pressureOffPeakRule(),
    rampTooGentleRule(),
    frontLockRule('under braking'),
    rearLockRule(),
    transferHeadroomRule(),
    cornerGripLimitedRule(cornerIsPaying),
    dragCostRule(),
    noiseRule(),
    setupHeadroomRule(),
  ],
  conditions: { base: DRY.base, variation: { gripFrac: 0.01, trackTempC: 3 } },
  passOn: 'any_run',
  scoreTarget: 'time',
  assist: true,
  segmentFloorSource: 'engine_optimum',
  artifacts: [
    // Stage 9 "Make the call": a one-sample sensor spike mid-straight, where the rear tire is
    // only at its normal driven slip. Sensor layer only; disclosed on the Model page.
    { run: 2, channel: 'speed_diff_rl', kind: 'spike', at: { s: SPIKE_AT_M }, magnitude: 7.7 },
  ],
  call: {
    afterRun: 2,
    question:
      '`speed_diff_rl` jumped to {value:speed} for one sample at {at:distance}, mid-straight. What do you do?',
    options: [
      {
        id: 'act',
        text: 'Act on it now: that is wheelspin, so change a lever for the next run.',
        correct: false,
        why: 'A lever change on one sample spends a run on a reading nothing else confirms. Real wheelspin moves `rear_slip_ratio`, `wheel_speed_rl`, `speed` and `long_g` together.',
      },
      {
        id: 'flag',
        text: 'Flag it as a possible sensor artifact and cross-check the related channels before acting.',
        correct: true,
        why: 'Real wheelspin moves `rear_slip_ratio`, `wheel_speed_rl`, `speed` and `long_g` together; this spike moves one channel for one sample. Flag it, check, and act only on what agrees.',
      },
      {
        id: 'discard',
        text: 'Throw out all the high readings on `speed_diff_rl` from now on.',
        correct: false,
        why: 'Discarding every high reading also discards real wheelspin, which is what the channel is for. Flag the sample, not the channel.',
      },
    ],
    crossCheck: ['rear_slip_ratio', 'wheel_speed_rl', 'speed', 'long_g'],
  },
  debrief: {
    physics: [
      'Every effect from the earlier levels is on this track at once: `rear_slip_ratio` and `speed_diff_rl` on the launch and out of the hairpin, `load_rear`, `load_front` and `front_slip_ratio` in the braking, `mu_rear` on the pressure bell, `drag_force` on the straights.',
      'The fastest setup is one compromise across all five segments, which `segment_delta` shares out: a launch spin can be cured by a longer ramp or by more rear weight, the same wheelspin solved by a different lever, and here the ramp wins, because the rear weight the corners want already locks the fronts for the last moments of the stop, even at the best setup; two hundred channels move every run, and the few that answer the question are the ones the earlier levels taught.',
    ],
    causal: B4L_CAUSAL,
  },
};
