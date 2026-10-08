/**
 * Report fixtures: everything the dev route and the tests need to render the report without the
 * engine (Stage 2) or telemetry (Stage 3).
 */
import type { ChannelId, Setup, TrackGeometry } from '@/engine/types';
import type { HintText } from '@/hints/types';
import type { LeverSpec } from '@/levels/types';
import type { RunSummary, RunTelemetry } from '@/telemetry/types';
import { setChannelLookup } from '../channel-meta';
import { FIXTURE_META, fixtureChannelIds, type FixtureSize } from './channels';
import {
  BEST_VARIANT,
  CURRENT_VARIANT,
  makeFixtureRun,
  runTime,
  summarizeFixture,
  type RunVariant,
} from './run';
import { FIXTURE_SEGMENT_LABELS, FIXTURE_SEGMENT_STARTS, makeFixtureTrack } from './track';

export * from './channels';
export * from './run';
export * from './track';

export interface ReportFixture {
  size: FixtureSize;
  ids: ChannelId[];
  track: TrackGeometry;
  segmentLabels: string[];
  /** Segment starts in m (distance axis), first one is 0. */
  segmentStartsS: number[];
  current: RunTelemetry;
  best: RunTelemetry;
  /** Two older runs for the "all runs" overlay. */
  history: RunTelemetry[];
  currentSummary: RunSummary;
  bestSummary: RunSummary;
  currentTime: number;
  bestTime: number;
}

const HISTORY_VARIANTS: RunVariant[] = [
  { seed: 11, slipPeak: 0.24, slipLoss: 0.4, slipWindow: [0.25, 1.4] },
  { seed: 12, slipPeak: 0.14, slipLoss: 0.18, slipWindow: [0.3, 1.0] },
];

const cache = new Map<FixtureSize, ReportFixture>();

/** Points `channelMeta()` at the fixture metadata. */
export function installFixtureChannelMeta(): void {
  setChannelLookup((id) => FIXTURE_META[id]);
}

/** A current run, a best run and two history runs over the fixture track (memoised per size). */
export function makeReportFixture(size: FixtureSize = 12): ReportFixture {
  const hit = cache.get(size);
  if (hit) return hit;
  const ids = fixtureChannelIds(size);
  const current = makeFixtureRun(CURRENT_VARIANT, ids);
  const best = makeFixtureRun(BEST_VARIANT, ids);
  const fx: ReportFixture = {
    size,
    ids,
    track: makeFixtureTrack(),
    segmentLabels: [...FIXTURE_SEGMENT_LABELS],
    segmentStartsS: [...FIXTURE_SEGMENT_STARTS],
    current,
    best,
    history: HISTORY_VARIANTS.map((v) => makeFixtureRun(v, ids)),
    currentSummary: summarizeFixture(current),
    bestSummary: summarizeFixture(best),
    currentTime: runTime(current),
    bestTime: runTime(best),
  };
  cache.set(size, fx);
  return fx;
}

/** Unlocked levers for the header fixture (A2-like). */
export const FIXTURE_LEVERS: LeverSpec[] = [
  {
    id: 'throttle_ramp',
    label: 'Throttle ramp',
    quantity: 'time',
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 0.4,
  },
  {
    id: 'tire_pressure',
    label: 'Tire pressure',
    quantity: 'pressure',
    min: 1.2,
    max: 2.2,
    step: 0.05,
    default: 1.7,
  },
];

export const FIXTURE_LOCKED: Partial<Setup> = { weight_dist: 0.45, wing: 4 };

export const FIXTURE_SETUP: Setup = {
  throttle_ramp: 0.4,
  tire_pressure: 1.7,
  weight_dist: 0.45,
  wing: 4,
};

/** Opened hint tiers (observe, explain) with channel and value segments. */
export const FIXTURE_HINTS: HintText[] = [
  {
    text: '`rear_slip_ratio` peaked at 0.18 between 0.30 s and 1.10 s.',
    segments: [
      { kind: 'channel', value: 'rear_slip_ratio' },
      { kind: 'text', value: ' peaked at ' },
      { kind: 'value', value: '0.180' },
      { kind: 'text', value: ' between ' },
      { kind: 'value', value: '0.300 s' },
      { kind: 'text', value: ' and ' },
      { kind: 'value', value: '1.100 s' },
      { kind: 'text', value: '.' },
    ],
  },
  {
    text:
      'Slip ratio above about 0.10 means the driven tires are spinning faster than the car is moving. ' +
      'Sliding rubber makes less force than gripping rubber, so `long_g` fell while the engine made full power.',
    segments: [
      {
        kind: 'text',
        value:
          'Slip ratio above about 0.10 means the driven tires are spinning faster than the car is moving. ' +
          'Sliding rubber makes less force than gripping rubber, so ',
      },
      { kind: 'channel', value: 'long_g' },
      { kind: 'text', value: ' fell while the engine made full power.' },
    ],
  },
];
