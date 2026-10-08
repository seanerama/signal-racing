import type { ComponentChildren } from 'preact';
import type { UnitSystem } from '@/units';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import './TopBar.css';

const UNIT_OPTIONS: readonly SegmentOption<UnitSystem>[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];

export interface TopBarProps {
  units: UnitSystem;
  onUnitsChange(next: UnitSystem): void;
  /** Breadcrumb / level slot (Stage 6). */
  children?: ComponentChildren;
}

/**
 * Top bar (placeholder, design-system.md "Navigation"): wordmark → level select, breadcrumb slot,
 * Units segmented control. Stage 6 adds run pips, the Axis control, ⌘K and ⓘ.
 */
export function TopBar({ units, onUnitsChange, children }: TopBarProps) {
  return (
    <header class="topbar" data-testid="topbar">
      <a class="topbar__wordmark" href="#/" aria-label="Signal: level select">
        SIGNAL
      </a>
      <div class="topbar__crumb">{children}</div>
      <div class="topbar__controls">
        <SegmentedControl
          label="Units"
          options={UNIT_OPTIONS}
          value={units}
          onChange={onUnitsChange}
        />
      </div>
    </header>
  );
}
