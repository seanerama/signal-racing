/**
 * B4L "The Puzzle" (signal.md "The Puzzle and the AI assist"; meeting-cut lite). Every team
 * arrives with data and limited practice time; the question is who puts the puzzle together
 * fastest. An open circuit (main straight, fast right, back straight, hairpin, run to a stop),
 * all four levers, conditions that vary between runs, ten runs, and the whole channel registry
 * (~210 channels) of which seven are causal.
 *
 * Deliberately absent (M2/M3): anti-roll bars, tire temperature, fuel and wear. With one fixed
 * roll-stiffness split, the fast corner and the hairpin cannot be balanced separately yet.
 *
 * Hint rules: the union of A2, A3, A4 and B1L, plus the noise rule. A3's `launch_spin` is left out:
 * on this track the drive-only `wheelspin` rule reports the same launch slide.
 *
 * `oil_temp` is in the default stack on purpose: it is plausible, it moves, and it explains
 * nothing.
 */
import { noiseRule } from '@/hints/engine';
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
import { frontLockRule, transferHeadroomRule } from './a3-weight';
import { cornerGripLimitedRule, dragCostRule } from './a4-corner';
import { cornerIsPaying, segmentPayingRule } from './b1l-join';

const OUTCOME: ChannelId[] = ['segment_time', 'delta_best', 'top_speed'];
export const B4L_CAUSAL: ChannelId[] = [
  'rear_slip_ratio',
  'front_slip_ratio',
  'load_front',
  'drag_force',
  'speed_diff_rl',
  'mu_rear',
  'segment_delta',
];

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
    'The assembled track: the straight and fast corner from the join, a back straight, a hairpin and a run to a stop, with grip and track temperature moving a little every run. Every lever is open, ten runs, and about two hundred channels, of which a handful matter. The assist toggle at the top of the channel table ranks channels against lap time once you have three runs: a filter, not a decider.',
  track: TRACK_PUZZLE,
  flags: FLAGS_GRIP,
  levers: [rampLever(0.4), pressureLever(1.7), weightLever(0.46), wingLever(7)],
  lockedLevers: {},
  runBudget: 10,
  tolerance: 0.005,
  hintCost: [1, 1, 1],
  channelSet: ALL,
  channelRoles: Object.fromEntries(ALL.map((id) => [id, roleOf(id)])),
  defaultStrips: ['segment_time', 'speed', 'throttle', 'engine_rpm', 'gear', 'oil_temp'],
  hintRules: [
    segmentPayingRule(),
    wheelspinRule(),
    pressureOffPeakRule(),
    rampTooGentleRule(),
    frontLockRule('under braking'),
    transferHeadroomRule(),
    cornerGripLimitedRule(cornerIsPaying),
    dragCostRule(),
    noiseRule(),
  ],
  conditions: { base: DRY.base, variation: { gripFrac: 0.01, trackTempC: 3 } },
  passOn: 'any_run',
  scoreTarget: 'time',
  assist: true,
  segmentFloorSource: 'engine_optimum',
  debrief: {
    physics: [
      'Every effect from the earlier levels is on this track at once: `rear_slip_ratio` and `speed_diff_rl` on the launch and out of the hairpin, `load_front` and `front_slip_ratio` in the braking, `mu_rear` on the pressure bell, `drag_force` on the straights.',
      'The fastest setup is the one compromise across all five segments, which `segment_delta` shares out; two hundred channels move every run, and the few that answer the question are the ones the earlier levels taught.',
    ],
    causal: B4L_CAUSAL,
  },
};
