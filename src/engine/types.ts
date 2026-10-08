/**
 * Core engine types (contract 01). FROZEN after Stage 1: a change needs a contract amendment
 * and notice to every consumer stage.
 *
 * All quantities are SI unless stated otherwise. The engine is pure and imports nothing from
 * outside `src/engine/` (lint-enforced), which is why `Quantity` lives here and `src/units`
 * re-exports it.
 */

/** A telemetry channel id: snake_case, stable forever (appears in CSVs and saved layouts), e.g. `'rear_slip_ratio'`. */
export type ChannelId = string;

/**
 * A setup lever the player can tune. Meeting cut: these four.
 * M2+ adds `'arb_front' | 'arb_rear' | 'fuel_load' | 'aggression'`.
 */
export type LeverId = 'throttle_ramp' | 'tire_pressure' | 'weight_dist' | 'wing';

/**
 * Physical quantity of a channel or lever. Drives unit conversion and display precision in
 * `src/units` (the engine itself is unit-agnostic and always SI).
 *
 * SI/storage bases: time s, distance m, speed m/s, accel_g g (system-invariant), force N, mass kg,
 * temperature °C, pressure bar, angle deg, rpm 1/min, power W, rate_deg_s deg/s, voltage V,
 * current A, dbm dBm, altitude m, flow kg/s, percent 0–1, fraction 0–1, ratio/dimensionless
 * unitless, gear and angle_int integers.
 */
export type Quantity =
  | 'time'
  | 'distance'
  | 'speed'
  | 'accel_g'
  | 'force'
  | 'mass'
  | 'temperature'
  | 'pressure'
  | 'ratio'
  | 'fraction'
  | 'angle'
  | 'angle_int'
  | 'rpm'
  | 'gear'
  | 'voltage'
  | 'current'
  | 'power'
  | 'rate_deg_s'
  | 'percent'
  | 'dbm'
  | 'altitude'
  | 'flow'
  | 'dimensionless';

/** Car parameters. Defaults (from the spec table) live in `DEFAULT_CAR` (Stage 2, `src/engine/car.ts`). */
export interface CarParams {
  /** kg, 750 (with driver; fuel mass is separate, see `fuelMass0`). */
  mass: number;
  /** W, 500_000. */
  power: number;
  /** N, 10_000: peak engine force (low-speed cap). */
  fPeak: number;
  /** m², 0.68: `CdA = cd0A + kdA·w²` (1.0 m² at w = 4). */
  cd0A: number;
  /** m², 0.02: wing-dependent drag coefficient in `CdA = cd0A + kdA·w²`. */
  kdA: number;
  /** m², 1.4: `ClA = cl0A + klA·w` (3.0 m² at w = 4). */
  cl0A: number;
  /** m², 0.4: wing-dependent lift coefficient in `ClA = cl0A + klA·w`. */
  klA: number;
  /** b, 0.55: share of downforce on the rear axle. */
  aeroBalanceRear: number;
  /** 1.6: peak tire friction coefficient. */
  muPeak: number;
  /** k_s, 0.1: tire load sensitivity. */
  kLoadSens: number;
  /** h, 0.30 m: centre-of-gravity height. */
  cogHeight: number;
  /** L, 3.0 m. */
  wheelbase: number;
  /** t, 1.9 m. */
  trackWidth: number;
  /** 0.015: rolling resistance coefficient. */
  crr: number;
  /** N, 16_000: total driver brake demand at full pedal. */
  brakeForceMax: number;
  /** 0.55: front brake bias (fixed in the meeting cut). */
  brakeBiasFront: number;
  /** bar, 1.65: optimal tire pressure (pressure → μ bell). */
  pOpt: number;
  /** bar, 0.9: width of the pressure → μ bell. */
  sigmaP: number;
  /** °C, 90: optimal tire temperature. */
  tOpt: number;
  /** °C, 25: width of the temperature → μ bell. */
  sigmaT: number;
  /** 0.10: slip ratio at peak force. */
  sPeak: number;
  /** 0.5: slip growth per unit of excess demand ratio while sliding. */
  kSlide: number;
  /** 0.8: usable fraction of F_max while sliding. */
  slideFactor: number;
  /** kg, 0 in the meeting cut (fuel not modelled in mass). */
  fuelMass0: number;
  /** q, 0.5: share of lateral load transfer taken by the front axle (lever from A5, fixed now). */
  arbFrontShare: number;
}

/**
 * Player setup: one value per lever.
 * Units: `throttle_ramp` s, `tire_pressure` bar, `weight_dist` fraction on the rear axle,
 * `wing` integer 0..8.
 */
export interface Setup {
  throttle_ramp: number;
  tire_pressure: number;
  weight_dist: number;
  wing: number;
}

export type SegmentKind = 'straight' | 'corner';

/** One segment of a track. */
export interface Segment {
  /** Stable id, e.g. `'launch'`, `'run_stop'`. */
  id: string;
  label: string;
  kind: SegmentKind;
  /** m. For a corner: arc length = radius × angle. */
  length: number;
  /** m, corner only. */
  radius?: number;
  /** Corner only. */
  direction?: 'left' | 'right';
  /** The car must stop exactly at the segment end (straights only). */
  endsWithStop?: boolean;
}

/**
 * Top-down track geometry. The start is at (0,0) heading +x (east).
 * Produced by the pure function `trackGeometry()` in `src/engine/track.ts` (Stage 2).
 */
export interface TrackGeometry {
  /** Interleaved x0,y0,x1,y1… in m, one point every 1 m along the path. */
  points: Float32Array;
  /** m. */
  totalLength: number;
  /** m along the track, one per segment. */
  segmentStarts: number[];
  /** m. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface Track {
  id: string;
  segments: Segment[];
  standingStart: boolean;
  laps: 1;
}

export interface Conditions {
  /** °C. */
  trackTemp: number;
  /** °C. */
  ambientTemp: number;
  /** Dry 1.0, damp 0.7, wet 0.5 (after per-run variation is applied). */
  gripMultiplier: number;
}

/**
 * Which physics is "switched on" for the level (principle 1: one concept per level).
 * Load transfer is always on: it is real physics, and it only becomes visible in the outcome once
 * `tractionLimit` is on, which is exactly the A2→A3 lesson.
 */
export interface ModelFlags {
  /** A1 false (infinite grip), true from A2. */
  tractionLimit: boolean;
  /** A1 false, true from A2. */
  pressureAffectsGrip: boolean;
  /** False in the meeting cut (temperatures are still computed and logged). */
  tempAffectsGrip: boolean;
}

/** Everything `simulate()` needs. The same input always gives a bit-identical result. */
export interface SimInput {
  car: CarParams;
  setup: Setup;
  track: Track;
  conditions: Conditions;
  flags: ModelFlags;
  /** uint32. */
  seed: number;
}

/** `'full'` records channel columns; `'fast'` runs the identical step function and skips column writes. */
export type SimMode = 'full' | 'fast';

export interface Outcome {
  /** s. `Infinity` when `finished` is false. */
  totalTime: number;
  /** s, one per segment, same order as `track.segments`. */
  segmentTimes: number[];
  /** m/s. */
  topSpeed: number;
  /** False if the sim diverged or timed out (then `totalTime = Infinity`). */
  finished: boolean;
}

/** Columnar physical telemetry at 100 Hz. Every array has length `n`. */
export interface PhysicalColumns {
  n: number;
  /** s, 0.01. */
  dt: number;
  /** s since start. */
  t: Float32Array;
  /** m along the track. */
  s: Float32Array;
  /** Segment index per sample. */
  seg: Uint8Array;
  /** Physical channels by id, SI (see contract 02 for the list). */
  ch: Record<ChannelId, Float32Array>;
}

export interface SimResult {
  outcome: Outcome;
  /** `'full'` mode only. */
  columns?: PhysicalColumns;
}
