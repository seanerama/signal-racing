/**
 * Minimal level fixtures for engine tests (Stage 6 owns the real level configs).
 * Lever ranges and locked values follow stage-2/stage-6 instructions.
 */
import { DEFAULT_CAR } from '@/engine/car';
import type { Conditions, ModelFlags, Setup, SimInput, Track } from '@/engine/types';

export const CONDITIONS: Conditions = { trackTemp: 30, ambientTemp: 20, gripMultiplier: 1 };

export const FLAGS_A1: ModelFlags = {
  tractionLimit: false,
  pressureAffectsGrip: false,
  tempAffectsGrip: false,
};
export const FLAGS_A2: ModelFlags = {
  tractionLimit: true,
  pressureAffectsGrip: true,
  tempAffectsGrip: false,
};

export const BASE_SETUP: Setup = {
  throttle_ramp: 0,
  tire_pressure: 1.65,
  weight_dist: 0.45,
  wing: 4,
};

export const TRACK_A1: Track = {
  id: 'a1',
  standingStart: true,
  laps: 1,
  segments: [{ id: 'launch', label: 'Launch', kind: 'straight', length: 1000 }],
};

export const TRACK_A3: Track = {
  id: 'a3',
  standingStart: true,
  laps: 1,
  segments: [
    {
      id: 'run_stop',
      label: 'Launch and stop',
      kind: 'straight',
      length: 1000,
      endsWithStop: true,
    },
  ],
};

export const TRACK_A4: Track = {
  id: 'a4',
  standingStart: true,
  laps: 1,
  segments: [
    { id: 'runup', label: 'Run-up', kind: 'straight', length: 200 },
    {
      id: 'corner',
      label: 'Corner',
      kind: 'corner',
      length: 80 * (Math.PI / 2),
      radius: 80,
      direction: 'left',
    },
    { id: 'runout', label: 'Run-out', kind: 'straight', length: 150 },
  ],
};

export const TRACK_B1: Track = {
  id: 'b1l',
  standingStart: true,
  laps: 1,
  segments: [
    { id: 'straight', label: 'Straight', kind: 'straight', length: 1000 },
    {
      id: 'fast_corner',
      label: 'Fast corner',
      kind: 'corner',
      length: 150 * (Math.PI / 2),
      radius: 150,
      direction: 'right',
    },
    { id: 'runout', label: 'Run-out', kind: 'straight', length: 150 },
  ],
};

/** The B4L ("Puzzle-lite") circuit from the Stage 8 notes: the longest meeting-cut track. */
export const TRACK_B4: Track = {
  id: 'b4l',
  standingStart: true,
  laps: 1,
  segments: [
    { id: 'main_straight', label: 'Main straight', kind: 'straight', length: 1000 },
    {
      id: 'fast_corner',
      label: 'Fast corner',
      kind: 'corner',
      length: 150 * (Math.PI / 2),
      radius: 150,
      direction: 'right',
    },
    { id: 'back_straight', label: 'Back straight', kind: 'straight', length: 500 },
    {
      id: 'hairpin',
      label: 'Hairpin',
      kind: 'corner',
      length: 35 * Math.PI,
      radius: 35,
      direction: 'right',
    },
    { id: 'run_stop', label: 'Run to stop', kind: 'straight', length: 400, endsWithStop: true },
  ],
};

/** Lever grids (inclusive), built from integers to avoid float drift. */
export const RAMPS = Array.from({ length: 16 }, (_, i) => i / 10);
export const PRESSURES = Array.from({ length: 11 }, (_, i) => (12 + i) / 10);
export const WEIGHT_DISTS = Array.from({ length: 8 }, (_, i) => (38 + 2 * i) / 100);
export const WINGS = Array.from({ length: 9 }, (_, i) => i);

export function input(track: Track, flags: ModelFlags, setup: Partial<Setup> = {}): SimInput {
  return {
    car: { ...DEFAULT_CAR },
    setup: { ...BASE_SETUP, ...setup },
    track: structuredClone(track),
    conditions: { ...CONDITIONS },
    flags: { ...flags },
    seed: 1,
  };
}
