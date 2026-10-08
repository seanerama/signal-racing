/**
 * Result header (contract 07, design-system "Result header"), above the stack.
 *
 * Line 1: run time (Readout XL; `--best` with a PB chip on a new personal best), Δbest and
 * Δtarget (Readout L, glyph + sign + colour), TARGET chip on a pass, extra chips (e.g. the
 * compromise gap), `RUN n`, and the debrief CTA on a pass.
 * Line 2: the setup used as compact chips; levers changed since the previous run get an
 * `--accent` underline, locked levers are `--text-faint` with 🔒.
 *
 * A new run is announced through the `aria-live` region.
 */
import { useEffect } from 'preact/hooks';
import type { LeverId, Quantity } from '@/engine/types';
import { formatValue, unitLabel } from '@/units';
import { Button } from '@/app/components/Button';
import { announce, runAnnouncement } from './a11y';
import { DeltaValue } from './DeltaValue';
import { LockGlyph } from './LockGlyph';
import type { ResultHeaderProps } from './types';
import './report.css';

/** Short chip names (design-system wireframe: `ramp 0.40 s · pressure 1.70 bar · wd 0.45🔒`). */
export const LEVER_SHORT: Record<LeverId, string> = {
  throttle_ramp: 'ramp',
  tire_pressure: 'pressure',
  weight_dist: 'wd',
  wing: 'wing',
};

/** Quantities for levers that may arrive locked (no LeverSpec). Matches contract 01 units. */
export const LEVER_QUANTITY: Record<LeverId, Quantity> = {
  throttle_ramp: 'time',
  tire_pressure: 'pressure',
  weight_dist: 'fraction',
  wing: 'angle_int',
};

const LEVER_ORDER: LeverId[] = ['throttle_ramp', 'tire_pressure', 'weight_dist', 'wing'];

export interface SetupChip {
  id: LeverId;
  name: string;
  value: string;
  locked: boolean;
  changed: boolean;
}

/** Setup chips: unlocked levers (spec order) then locked ones. */
export function setupChips(
  props: Pick<ResultHeaderProps, 'run' | 'levers' | 'lockedLevers' | 'units'>,
): SetupChip[] {
  const { run, levers, lockedLevers, units } = props;
  if (!run) return [];
  const chips: SetupChip[] = [];
  const unlocked = new Set(levers.map((l) => l.id));
  for (const l of levers) {
    chips.push({
      id: l.id,
      name: LEVER_SHORT[l.id] ?? l.id,
      value: formatValue(l.quantity, units, run.setup[l.id]),
      locked: false,
      changed: run.changed.includes(l.id),
    });
  }
  for (const id of LEVER_ORDER) {
    const v = lockedLevers[id];
    if (unlocked.has(id) || v === undefined) continue;
    chips.push({
      id,
      name: LEVER_SHORT[id],
      value: formatValue(LEVER_QUANTITY[id], units, v),
      locked: true,
      changed: false,
    });
  }
  return chips;
}

export function ResultHeader(props: ResultHeaderProps) {
  const { run, bestTime, target, isPB, passed, units, extra, onDebrief, actions } = props;

  useEffect(() => {
    if (!run) return;
    announce(runAnnouncement({ index: run.index, time: run.time, bestTime, target }));
    // Announce once per run, not on unrelated re-renders.
  }, [run?.index]);

  if (!run) {
    return (
      <header class="rh rh--empty" data-testid="result-header">
        <span class="rh__time rh__time--none">—</span>
        <span class="data faint">No run yet. Set up the car and press RUN.</span>
      </header>
    );
  }

  const chips = setupChips(props);
  const timeText = formatValue('time', units, run.time, { withUnit: false });
  return (
    <header class="rh" data-testid="result-header">
      <div class="rh__line1">
        <span class={`rh__time${isPB ? ' rh__time--pb' : ''}`} data-testid="rh-time">
          {timeText}
          <span class="rh__unit micro">{unitLabel('time', units)}</span>
        </span>
        {isPB && (
          <span class="chip chip--best" data-testid="chip-pb">
            PB
          </span>
        )}
        <DeltaValue value={bestTime === null ? null : run.time - bestTime} label="best" />
        <DeltaValue value={target === null ? null : run.time - target} label="target" />
        {passed && (
          <span class="chip chip--best" data-testid="chip-target">
            TARGET
          </span>
        )}
        {extra?.map((x) => (
          <span key={x.label} class={`chip chip--extra${x.tone ? ` chip--${x.tone}` : ''}`}>
            <span class="chip__label">{x.label}</span> {x.value}
          </span>
        ))}
        <span class="rh__spacer" />
        <span class="rh__run micro dim">{`RUN ${run.index}`}</span>
        {actions}
        {passed && onDebrief && (
          <Button variant="secondary" size="compact" onClick={() => onDebrief()}>
            Continue to debrief
          </Button>
        )}
      </div>
      <div class="rh__line2" aria-label="Setup used">
        {chips.map((c) => (
          <span
            key={c.id}
            class={`setchip data${c.locked ? ' setchip--locked' : ''}${c.changed ? ' setchip--changed' : ''}`}
            data-lever={c.id}
            aria-disabled={c.locked || undefined}
            title={
              c.locked
                ? `${c.name} locked at ${c.value}`
                : c.changed
                  ? `${c.name} changed since last run`
                  : undefined
            }
          >
            <span class="setchip__name">{c.name}</span> {c.value}
            {c.locked && <LockGlyph class="setchip__lock" />}
          </span>
        ))}
      </div>
    </header>
  );
}
