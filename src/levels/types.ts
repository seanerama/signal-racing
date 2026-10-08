/**
 * Level config types (contract 04). Written by Stage 1; content (A1–A4) in Stage 6 and
 * (B1L, B4L) in Stage 8. FROZEN after Stage 1.
 *
 * Levels are typed TS modules (pure data + pure predicates), not JSON. `LEVELS` (in unlock
 * order) is exported from `src/levels/index.ts` by the content stages.
 */
import type {
  CarParams,
  ChannelId,
  Conditions,
  LeverId,
  ModelFlags,
  Quantity,
  Setup,
  Track,
} from '@/engine/types';
import type { HintRule } from '@/hints/types';
import type { Role, SensorArtifact } from '@/telemetry/types';

export type { SensorArtifact };

/** Level ids. `L` = meeting-cut "lite" variants. */
export type LevelId = 'A1' | 'A2' | 'A3' | 'A4' | 'B1L' | 'B4L';

/** One unlocked lever. Discrete: grid search evaluates exactly these step points. */
export interface LeverSpec {
  id: LeverId;
  label: string;
  quantity: Quantity;
  /** SI. */
  min: number;
  /** SI. */
  max: number;
  /** SI. */
  step: number;
  /** SI, must lie on the step grid. */
  default: number;
}

/** Base conditions plus optional per-run variation (applied from the run seed). */
export interface ConditionsSpec {
  base: Conditions;
  variation?: {
    /** 0.01 = ±1% grip. */
    gripFrac: number;
    /** ±°C track temperature. */
    trackTempC: number;
  };
}

/**
 * A level definition.
 *
 * Hint template syntax (in `HintRule.tiers`): `{name}` inserts `vars.name` raw; `{name:speed}`
 * formats it through `formatValue` with that quantity. Channel ids are wrapped in backticks and
 * render as clickable mono links. Tier 3 names a lever and a direction, never a value.
 */
export interface LevelConfig {
  id: LevelId;
  configVersion: number;
  phase: 'A' | 'B';
  title: string;
  concept: string;
  /** 2–4 sentences, Body copy. */
  brief: string;
  track: Track;
  flags: ModelFlags;
  /** Overrides on `DEFAULT_CAR`. */
  car?: Partial<CarParams>;
  /** Unlocked levers. */
  levers: LeverSpec[];
  /** Shown greyed at these values. */
  lockedLevers: Partial<Setup>;
  runBudget: number;
  /** 0.01 = 1%. */
  tolerance: number;
  /** Runs consumed per hint tier; default `[1, 1, 1]`. */
  hintCost: [number, number, number];
  /** Which registry channels exist on this level. */
  channelSet: ChannelId[];
  /** Every id in `channelSet` must have a role. */
  channelRoles: Record<ChannelId, Role>;
  /** 4–6 ids. MUST contain no `'causal'` ids (enforced by test). */
  defaultStrips: ChannelId[];
  hintRules: HintRule[];
  conditions: ConditionsSpec;
  /** Meeting cut: `'any_run'` for all. */
  passOn: 'any_run' | 'total';
  /** B1L uses `'compromise_gap'`. */
  scoreTarget?: 'time' | 'compromise_gap';
  debrief: {
    /** Two sentences of physics. */
    physics: [string, string];
    causal: ChannelId[];
  };
  /** B4L only. */
  assist?: boolean;
  /** Join levels: per-segment optimum from grid search. */
  segmentFloorSource?: 'engine_optimum';
  /**
   * Stage 9, additive (contract 04 amendment): planted SENSOR artifacts. Applied in
   * `RunTelemetry.get()` after noise on the named run; never in `getClean()`, hint rules, the
   * assist or the outcome. Disclosed on the Model page.
   */
  artifacts?: SensorArtifact[];
  /** Stage 9, additive: the "Make the call" judgment prompt after a run. */
  call?: CallSpec;
}

/** One answer to a "Make the call" prompt. */
export interface CallOption {
  id: string;
  text: string;
  /** Exactly one option is correct: flag it and cross-check before acting. */
  correct: boolean;
  /** One sentence, shown after answering and in the debrief. */
  why: string;
}

/**
 * "Make the call" (Stage 9): after run `afterRun`'s report renders, a panel asks what to do about
 * a reading. Answering costs no runs; the answer is recorded on the session and shown in the
 * debrief. `question` uses the hint template syntax; vars: `value` (the planted reading, SI),
 * `at` (its distance, m) and `t` (its time, s), from the first artifact on `afterRun`.
 */
export interface CallSpec {
  afterRun: number;
  question: string;
  options: CallOption[];
  /** Channels that tell a real effect from a sensor fault: one-click "add to stack". */
  crossCheck: ChannelId[];
}
