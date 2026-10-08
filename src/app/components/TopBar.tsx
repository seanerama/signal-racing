import type { ComponentChildren } from 'preact';
import type { UnitSystem } from '@/units';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import './TopBar.css';

const UNIT_OPTIONS: readonly SegmentOption<UnitSystem>[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];

const AXIS_OPTIONS: readonly SegmentOption<'time' | 'distance'>[] = [
  { value: 'time', label: 'Time' },
  { value: 'distance', label: 'Dist' },
];

export interface TopBarProps {
  units: UnitSystem;
  onUnitsChange(next: UnitSystem): void;
  /** Breadcrumb / level slot. */
  children?: ComponentChildren;
  /** Run pips (in a level). */
  pips?: ComponentChildren;
  axis?: 'time' | 'distance';
  onAxisChange?(next: 'time' | 'distance'): void;
  /** The Axis control is enabled from Phase B. */
  axisEnabled?: boolean;
  onPalette?(): void;
  /** ⓘ brief (in a level). */
  onBrief?(): void;
  /** Status chips before the controls (Stage 8: `DEMO PROFILE`). */
  status?: ComponentChildren;
}

/**
 * Top bar (design-system "Navigation"): wordmark → level select · level breadcrumb · run pips ·
 * Units · Axis (enabled from Phase B) · ⌘K command palette · ⓘ brief.
 */
export function TopBar({
  units,
  onUnitsChange,
  children,
  pips,
  axis = 'time',
  onAxisChange,
  axisEnabled = false,
  onPalette,
  onBrief,
  status,
}: TopBarProps) {
  return (
    <header class="topbar" data-testid="topbar">
      <a class="topbar__wordmark" href="#/" aria-label="Signal: level select">
        SIGNAL
      </a>
      <div class="topbar__crumb">{children}</div>
      {pips && <div class="topbar__pips">{pips}</div>}
      {status && <div class="topbar__status">{status}</div>}
      <div class="topbar__controls">
        <SegmentedControl
          label="Units"
          options={UNIT_OPTIONS}
          value={units}
          onChange={onUnitsChange}
        />
        {onAxisChange && (
          <SegmentedControl
            label="Axis"
            options={AXIS_OPTIONS}
            value={axis}
            onChange={onAxisChange}
            disabled={!axisEnabled}
          />
        )}
        {onPalette && (
          <button
            type="button"
            class="topbar__icon mono"
            onClick={onPalette}
            aria-label="Command palette"
            title="Command palette (⌘K)"
            data-testid="palette-button"
          >
            ⌘K
          </button>
        )}
        {onBrief && (
          <button
            type="button"
            class="topbar__icon topbar__icon--svg"
            onClick={onBrief}
            aria-label="Brief"
            title="Brief"
            data-testid="brief-button"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.2" />
              <rect x="6.4" y="6" width="1.2" height="4.2" fill="currentColor" />
              <rect x="6.4" y="3.6" width="1.2" height="1.3" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
