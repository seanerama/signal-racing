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
import type { Role } from '@/telemetry/types';

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
}
