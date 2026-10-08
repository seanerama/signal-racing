/**
 * Telemetry types (contract 03). Written by Stage 1 (types only); Stage 3 implements the
 * registry, run telemetry, summary and CSV against these. FROZEN after Stage 1.
 */
import type { ChannelId, PhysicalColumns, Quantity, Setup } from '@/engine/types';
import type { UnitSystem } from '@/units';

/**
 * A channel's role on a given level. Roles are NOT on `ChannelDef`: they are per level, in
 * `LevelConfig.channelRoles` (contract 04), so a distractor can graduate to causal later.
 * Roles are never shown in the UI before the debrief.
 */
export type Role = 'outcome' | 'causal' | 'correlated' | 'distractor';

/** Families of distractor generators. Distractors depend on `(t, s, throttle, speed)` only, never on setup levers. */
export type DistractorFamily =
  /** Oil/water/gearbox temp: warms with time · throttle, independent of setup. */
  | 'slow_drift'
  /** Battery voltage, fuel pressure. */
  | 'flat_noisy'
  /** Radio RSSI, ambient pressure with a slow wobble. */
  | 'periodic'
  /** GPS altitude jitter, steering torque on a straight. */
  | 'random_walk'
  /** Pit-radio flag, DRS-like status bits. */
  | 'step_events'
  /** Correlated with throttle but explains nothing (e.g. intake air temp). */
  | 'throttle_echo'
  /** Correlated with speed (e.g. aero probe pressure): produces spurious correlation for the assist. */
  | 'speed_echo';

/** Inputs available to a derived channel's `compute`. */
export interface DeriveCtx {
  run: PhysicalColumns;
  /** The best run so far in this level, if any. */
  best?: PhysicalColumns;
  /** s, per segment (join levels). */
  segmentFloors?: number[];
  /** s, per segment, this run. */
  segmentStartTimes: number[];
}

/** Where a channel's samples come from. */
export type ChannelSource =
  /** Straight from `PhysicalColumns.ch[id]`. */
  | { kind: 'physical' }
  /** Computed from the run, e.g. `delta_best`, `segment_delta`, `speed_diff_rl`. */
  | { kind: 'derived'; compute: (ctx: DeriveCtx) => Float32Array }
  /** Generated lazily from a seeded family. */
  | { kind: 'distractor'; family: DistractorFamily; params: Record<string, number> };

/** One entry in the channel registry (`src/telemetry/registry.ts`). */
export interface ChannelDef {
  /** snake_case, stable forever. Never a name that hints at irrelevance (`dummy_*`, `noise_*`). */
  id: ChannelId;
  /** Human label, e.g. `'Rear slip ratio'`. */
  label: string;
  quantity: Quantity;
  group:
    | 'chassis'
    | 'tires'
    | 'aero'
    | 'powertrain'
    | 'brakes'
    | 'electrical'
    | 'environment'
    | 'timing'
    | 'misc';
  source: ChannelSource;
  noise: {
    /** 0.01–0.03 of the channel range. */
    sigmaFrac: number;
    /** Per-sample dropout probability, ≤ 0.002. */
    dropoutRate: number;
  };
  /**
   * Physically bounded sensors (Stage 8 amendment, additive): the noisy value is clamped to
   * `[min, max]` after noise (a pot or a wheel-speed sensor cannot read outside its range).
   * Dropouts stay NaN. Absent = unbounded.
   */
  clamp?: readonly [number, number];
}

/**
 * One run's telemetry for a level's channel set. Channels are materialised lazily (noise and
 * dropouts applied) and cached. Noise/distractor streams are seeded from
 * `createRng(seed).fork('noise:'+id)` / `fork('distractor:'+id)`, so `get(id)` is deterministic.
 */
export interface RunTelemetry {
  readonly n: number;
  /** s. */
  readonly dt: number;
  readonly t: Float32Array;
  readonly s: Float32Array;
  readonly seg: Uint8Array;
  /** The level's channel set, in registry order. */
  readonly channelIds: readonly ChannelId[];
  /** Lazily materialises (noise + dropouts applied) and caches. Dropouts are NaN. */
  get(id: ChannelId): Float32Array;
  /** Noise-free value, used by hint rules that need the physics truth (e.g. threshold crossings). */
  getClean(id: ChannelId): Float32Array;
}

/**
 * A deliberately planted SENSOR artifact (Stage 9 "Make the call"; contract 03/04 amendment). It
 * lives in the sensor layer only: `RunTelemetry.get()` applies it after noise, deterministically;
 * `getClean()` never sees it, so the physics, hint rules, the assist and the outcome ignore it.
 *
 * - `spike`: the reading at `at` is offset by `magnitude` (SI) for one sample (or `durationS`).
 * - `step`: the reading is offset by `magnitude` from `at` to the end of the run (or `durationS`).
 * - `stuck`: the reading freezes at its value at `at` (plus `magnitude`) for `durationS`
 *   (default one sample).
 *
 * `at` picks the first sample with `t ≥ at.t` (or, without `t`, `s ≥ at.s`). An artifact on a
 * physical channel carries into the math channels computed from it (they read `get()`); an
 * artifact on a math channel moves that channel only.
 */
export interface SensorArtifact {
  /** 1-based run index the artifact is planted on. */
  run: number;
  channel: ChannelId;
  kind: 'spike' | 'stuck' | 'step';
  at: { t?: number; s?: number };
  /** SI. */
  magnitude: number;
  /** s. */
  durationS?: number;
}

/** Arguments to `createRunTelemetry()` (`src/telemetry/run-telemetry.ts`, Stage 3). */
export interface CreateRunTelemetryArgs {
  physical: PhysicalColumns;
  channelIds: ChannelId[];
  seed: number;
  best?: PhysicalColumns;
  segmentFloors?: number[];
  /**
   * Stage 9, additive: sensor artifacts for THIS run (the caller filters by run index). Applied in
   * `get()` only.
   */
  artifacts?: readonly SensorArtifact[];
}

/** Per-channel statistics. NaN-safe: dropouts are skipped and counted. */
export interface ChannelStats {
  min: number;
  max: number;
  mean: number;
  /** Sample index of the minimum. */
  argmin: number;
  /** Sample index of the maximum. */
  argmax: number;
  /** s. */
  tMin: number;
  /** s. */
  tMax: number;
  /** Number of NaN (dropout) samples. */
  dropouts: number;
}

/** Summary of one run (`summarize()` in `src/telemetry/summary.ts`, Stage 3). */
export interface RunSummary {
  /** Over the noisy series (what the player sees). */
  stats: Record<ChannelId, ChannelStats>;
  /** Over the clean series (what rules use). */
  clean: Record<ChannelId, ChannelStats>;
  /** First and last time a predicate holds on the clean series; null if never. */
  window(id: ChannelId, pred: (v: number) => boolean): { tStart: number; tEnd: number } | null;
  /** Same as `stats`, restricted to each segment. */
  perSegment: Array<Record<ChannelId, ChannelStats>>;
}

/** Metadata for `toCsv()` (`src/export/csv.ts`, Stage 3). */
export interface CsvMeta {
  levelId: string;
  run: number;
  seed: number;
  setup: Setup;
  units: UnitSystem;
}
