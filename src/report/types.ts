/**
 * Report component props (contract 07). Written by Stage 1 so Stages 6 and 8 can compose the
 * report while Stage 4 builds it. Stage 4's components import their props from here.
 *
 * All components are Preact, styled only with tokens from `src/styles/tokens.css`, and must
 * render from fixture data (`src/report/__fixtures__/`).
 */
import type { ComponentChildren } from 'preact';
import type { ChannelId, LeverId, Quantity, Setup, TrackGeometry } from '@/engine/types';
import type { HintText } from '@/hints/types';
import type { LeverSpec } from '@/levels/types';
import type { RunSummary, RunTelemetry } from '@/telemetry/types';
import type { UnitSystem } from '@/units';

/** A cited time window, shaded on the named strip only. */
export interface HintWindow {
  channel: ChannelId;
  tStart: number;
  tEnd: number;
}

/** One item in a strip's gutter menu (e.g. Stage 7's "Waterfall…"). */
export interface GutterMenuItem {
  label: string;
  onSelect(): void;
  /** Stage 9: a toggle item (`menuitemcheckbox`), e.g. "Smooth (5-pt centred mean)". */
  checked?: boolean;
}

/** `src/report/StripStack.tsx`: the synced uPlot strip stack. */
export interface StripStackProps {
  current: RunTelemetry | null;
  best: RunTelemetry | null;
  /** Optional dim "all runs" overlay. */
  history?: RunTelemetry[];
  /** Order = display order. */
  strips: ChannelId[];
  /** Add/remove/reorder. */
  onStripsChange(next: ChannelId[]): void;
  /** Ids missing from the level render as a placeholder row. */
  availableIds: ReadonlySet<ChannelId>;
  axis: 'time' | 'distance';
  /** In axis units; dashed rules through all strips. */
  segmentBoundaries?: number[];
  segmentLabels?: string[];
  hintWindow?: HintWindow | null;
  units: UnitSystem;
  /** Gutter pulse when a hint/assist link is clicked. */
  flashChannel?: ChannelId | null;
  /** Optional per-strip gutter menu (a `⋯` button on hover/focus). Omitted: no menu. */
  gutterMenu?: (id: ChannelId) => GutterMenuItem[];
  /**
   * Stage 9: strips drawn with the display-only 5-point smoothing (a `~` beside the id and on the
   * readouts). The channel table stays raw.
   */
  smoothed?: ReadonlySet<ChannelId>;
}

/** `src/report/ChannelTable.tsx`: the virtualised channel table. */
export interface ChannelTableProps {
  /** The level's channel set. */
  ids: ChannelId[];
  current: RunSummary | null;
  best: RunSummary | null;
  inStack: ReadonlySet<ChannelId>;
  onToggle(id: ChannelId): void;
  units: UnitSystem;
  /** Slot: the assist block docks here (Stage 8). */
  header?: ComponentChildren;
}

/** An extra header chip, e.g. the compromise gap. */
export interface ResultHeaderExtra {
  label: string;
  value: string;
  tone?: 'gain' | 'loss' | 'best';
}

/** `src/report/ResultHeader.tsx`. */
export interface ResultHeaderProps {
  run: { index: number; time: number; setup: Setup; changed: LeverId[] } | null;
  bestTime: number | null;
  target: number | null;
  isPB: boolean;
  passed: boolean;
  lockedLevers: Partial<Setup>;
  levers: LeverSpec[];
  extra?: ResultHeaderExtra[];
  units: UnitSystem;
  onDebrief?(): void;
  /** Stage 8, additive: secondary actions on line 1 (Export CSV). */
  actions?: ComponentChildren;
}

/** `src/report/RunPips.tsx`. */
export interface RunPipsProps {
  budget: number;
  usedByRuns: number;
  usedByHints: number;
}

/** `src/report/HintPopover.tsx`. */
export interface HintPopoverProps {
  tiersOpened: number;
  cost: [number, number, number];
  runsLeft: number;
  /** Opened tiers only. */
  texts: HintText[];
  /** Armed → confirm inside the button; no dialogs. */
  onOpenNext(): void;
  onChannelClick(id: ChannelId): void;
}

/** `src/report/TrackView.tsx`: 2D canvas, design-system "Track view". */
export interface TrackViewProps {
  geometry: TrackGeometry;
  /** Uses `pos_x`, `pos_y`, `heading`. */
  current: RunTelemetry | null;
  /** Hollow block at the same t (or s, per axis mode). */
  best: RunTelemetry | null;
  /** The selected strip's channel; null = plain path. */
  colorBy?: ChannelId | null;
  segmentLabels: string[];
  units: UnitSystem;
  /** How the best-run block is aligned to the cursor. */
  axis: 'time' | 'distance';
}

/**
 * `src/report/GripCircle.tsx` (Stage 9, contract 07 addition): two friction circles (FRONT, REAR),
 * radius 1 = the axle's grip budget, the tire force demand as a dot at the shared cursor. Model
 * forces from the clean channels (`fx_*`, `fy_*`, `grip_budget_*`), labelled "model estimate".
 */
export interface GripCircleProps {
  current: RunTelemetry | null;
  /** Hollow `--trace-best` dot at the same t (or s, per `axis`). */
  best: RunTelemetry | null;
  axis: 'time' | 'distance';
  units: UnitSystem;
}

/** Arguments to `buildStripOptions()` in `src/report/uplot-theme.ts`. */
export interface StripOptionsArgs {
  slot: number;
  quantity: Quantity;
  units: UnitSystem;
  height: number;
  showXAxis: boolean;
  syncKey: string;
  projector: boolean;
}
