/**
 * Props for the 3D data views (Stage 7). Type-only: importing this never pulls in three.js.
 */
import type { ChannelId } from '@/engine/types';
import type { RunRecord } from '@/game/types';
import type { LevelConfig, LeverSpec } from '@/levels/types';
import type { UnitSystem } from '@/units';
import type { GridResult } from '@/worker/types';

export type AxisMode = 'time' | 'distance';

/** Run waterfall: one channel across every run of the session. */
export interface WaterfallProps {
  runs: RunRecord[];
  channel: ChannelId;
  units: UnitSystem;
  axis: AxisMode;
  /** 0-based strip slot of the channel: the current run is drawn in its hue. */
  slot: number;
  /** Unlocked levers, for the hover tooltip's setup chips. */
  levers?: LeverSpec[];
  /** `index` of the best run; default: the fastest finished run. */
  bestIndex?: number | null;
}

/** Response surface (debrief only: it reveals the optimum). */
export interface SurfaceProps {
  grid: GridResult;
  runs: RunRecord[];
  level: LevelConfig;
  units: UnitSystem;
}

/** A mounted view. `update` re-renders with new props; `dispose` frees every GPU resource. */
export interface ViewHandle<P> {
  update(props: P): void;
  dispose(): void;
  /** Resolves once three.js has loaded and the first frame is drawn. */
  ready: Promise<void>;
}
