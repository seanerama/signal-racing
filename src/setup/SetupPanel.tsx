/**
 * The setup panel (design-system "Workbench": left column): a column of lever widgets (unlocked
 * first, then the locked ones greyed at their fixed values so the whole setup is always visible),
 * then the sticky foot: hint controls and RUN. RUN shows the grid-search progress while the
 * target is computing ("COMPUTING TARGET 64%") and RUNNING while a run is in flight.
 */
import type { ComponentChildren } from 'preact';
import { Button } from '@/app/components/Button';
import type { LeverId, Setup } from '@/engine/types';
import type { LeverSpec, LevelConfig } from '@/levels/types';
import { LEVER_QUANTITY } from '@/report/ResultHeader';
import type { UnitSystem } from '@/units';
import { LeverWidget } from './LeverWidget';
import './setup.css';

const LOCKED_LABEL: Record<LeverId, string> = {
  throttle_ramp: 'Throttle ramp',
  tire_pressure: 'Tire pressure',
  weight_dist: 'Weight distribution',
  wing: 'Wing',
};

/** A LeverSpec for a locked lever (display only). */
function lockedSpec(id: LeverId, v: number): LeverSpec {
  return {
    id,
    label: LOCKED_LABEL[id],
    quantity: LEVER_QUANTITY[id],
    min: v,
    max: v,
    step: 1,
    default: v,
  };
}

export interface SetupPanelProps {
  level: LevelConfig;
  setup: Setup;
  onChange(next: Setup): void;
  /** Setup of the previous run (ghost markers, changed dots); null before the first run. */
  lastSetup: Setup | null;
  units: UnitSystem;
  onRun(): void;
  runState: 'computing' | 'running' | 'ready' | 'spent';
  /** Grid-search progress 0–1 while computing. */
  progress: number;
  /** Hint controls slot (rendered above RUN). */
  hints: ComponentChildren;
  /** Header slot (run pips). */
  header?: ComponentChildren;
}

export function SetupPanel({
  level,
  setup,
  onChange,
  lastSetup,
  units,
  onRun,
  runState,
  progress,
  hints,
  header,
}: SetupPanelProps) {
  const unlocked = new Set(level.levers.map((l) => l.id));
  const locked = (Object.keys(LOCKED_LABEL) as LeverId[]).filter(
    (id) => !unlocked.has(id) && level.lockedLevers[id] !== undefined,
  );
  const busy = runState === 'computing' || runState === 'running';
  const pct = Math.round(progress * 100);

  return (
    <aside class="setup" aria-label="Setup" data-testid="setup-panel">
      <div class="setup__head">
        <h2 class="h2 dim">Setup</h2>
        {header}
      </div>
      <div class="setup__levers">
        {level.levers.map((l) => (
          <LeverWidget
            key={l.id}
            spec={l}
            value={setup[l.id]}
            units={units}
            lastValue={lastSetup ? lastSetup[l.id] : null}
            onChange={(v) => onChange({ ...setup, [l.id]: v })}
          />
        ))}
        {locked.map((id) => (
          <LeverWidget
            key={id}
            spec={lockedSpec(id, level.lockedLevers[id] as number)}
            value={level.lockedLevers[id] as number}
            units={units}
            locked
          />
        ))}
      </div>
      <div class="setup__foot">
        {hints}
        <Button
          variant="primary"
          size="run"
          class="setup__run"
          onClick={onRun}
          busy={busy}
          busyLabel={runState === 'computing' ? `Computing target ${pct}%` : 'Running'}
          progress={runState === 'computing' ? progress : undefined}
          disabled={runState === 'spent'}
          data-testid="run-button"
          title="Run (R, ⌘⏎)"
        >
          {runState === 'spent' ? 'No runs left' : 'Run ⏎'}
        </Button>
      </div>
    </aside>
  );
}
