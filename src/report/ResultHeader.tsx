/**
 * Result header (contract 07, design-system "Result header"; Stage 10 style guide "Result bar"),
 * above the stack. Laid out like the guide's specimen: labelled metric cells.
 *
 * Line 1: LAP TIME (Barlow Condensed, ≥ 34 px, with its unit; a `PB` chip with a lime outline on
 * a new personal best), Δ BEST and Δ TARGET (sign + "faster"/"slower" + colour), RUNS
 * (`n · h hints`; no budget), a `TARGET MET` chip on a pass, extra chips (e.g. the compromise
 * gap), then the playback controls slot.
 * Line 2: the setup used as compact chips; levers changed since the previous run get an
 * `--accent` underline, locked levers are `--text-faint` with 🔒. At its right end, the actions
 * (Export CSV) and the debrief CTA on a pass.
 *
 * During the first playback of a run (`live`), the time cell counts up with the playhead and a
 * live speed takes the delta cells' place; the results appear when playback ends. A finished run
 * is announced through the `aria-live` region.
 */
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import type { LeverId, Quantity } from '@/engine/types';
import type { RunTelemetry } from '@/telemetry/types';
import { formatValue, unitLabel, type UnitSystem } from '@/units';
import { Button } from '@/app/components/Button';
import { announce, runAnnouncement } from './a11y';
import { DeltaValue } from './DeltaValue';
import { LockGlyph } from './LockGlyph';
import { playhead } from './playback';
import { plural } from './RunCount';
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

/** Time (s) and speed (m/s) of a run at sample `idx` (speed: the clean `speed` channel, or ds/dt). */
export function liveSample(rt: RunTelemetry, idx: number): { t: number; speed: number } {
  const i = Math.max(0, Math.min(rt.n - 1, idx));
  const t = rt.t[i] as number;
  if (rt.channelIds.includes('speed')) {
    try {
      const v = rt.getClean('speed')[i] as number;
      if (Number.isFinite(v)) return { t, speed: v };
    } catch {
      /* fall through to ds/dt */
    }
  }
  const a = Math.max(0, i - 1);
  const b = Math.min(rt.n - 1, i + 1);
  const dt = (rt.t[b] as number) - (rt.t[a] as number);
  const ds = (rt.s[b] as number) - (rt.s[a] as number);
  return { t, speed: dt > 0 ? ds / dt : 0 };
}

function Cell({
  label,
  children,
  class: cls,
  testId,
}: {
  label: ComponentChildren;
  children: ComponentChildren;
  class?: string;
  testId?: string;
}) {
  return (
    <div class={`rh__cell${cls ? ` ${cls}` : ''}`} data-testid={testId}>
      <span class="rh__label meta">{label}</span>
      <span class="rh__value">{children}</span>
    </div>
  );
}

/** The live counters while a run plays back: they subscribe to the playhead, not the header. */
function LiveCells({ rt, units, index }: { rt: RunTelemetry; units: UnitSystem; index: number }) {
  const idx = playhead.value ?? rt.n - 1;
  const { t, speed } = liveSample(rt, idx);
  return (
    <>
      <Cell
        label={
          <>
            <span class="rh__run">{`RUN ${index}`}</span>
            <span class="rh__livetag"> · LIVE</span>
          </>
        }
        class="rh__cell--time"
      >
        <span class="rh__time rh__time--live metric" data-testid="rh-live-time">
          {formatValue('time', units, t, { withUnit: false })}
          <span class="rh__unit">{unitLabel('time', units)}</span>
        </span>
      </Cell>
      <Cell label="Speed" testId="rh-live-speed">
        <span class="rh__metric-m metric">
          {formatValue('speed', units, speed, { withUnit: false })}
          <span class="rh__unit">{unitLabel('speed', units)}</span>
        </span>
      </Cell>
      <Cell label="Result">
        <span class="rh__pending">at the finish</span>
      </Cell>
    </>
  );
}

export function ResultHeader(props: ResultHeaderProps) {
  const { run, bestTime, target, isPB, passed, units, extra, onDebrief, actions } = props;
  const runs = props.runs ?? run?.index ?? 0;
  const hints = props.hints ?? 0;
  const live = props.live ?? null;

  useEffect(() => {
    if (!run || live) return;
    announce(runAnnouncement({ index: run.index, time: run.time, bestTime, target }));
    // Announce once per revealed run, not on unrelated re-renders.
  }, [run?.index, !!live]);

  const runsCell = (
    <Cell label="Runs" class="rh__cell--runs" testId="rh-runs">
      <span class="rh__metric-m metric">{runs}</span>
      <span class="rh__hints">{`· ${plural(hints, 'hint')}`}</span>
    </Cell>
  );

  if (!run && !live) {
    return (
      <header class="rh rh--empty" data-testid="result-header" data-run="0">
        <div class="rh__line1">
          <Cell label="Lap time" class="rh__cell--time">
            <span class="rh__time rh__time--none metric">—</span>
          </Cell>
          <p class="rh__hint-empty">No run yet. Set up the car and press RUN.</p>
          <span class="rh__spacer" />
          {props.controls}
        </div>
      </header>
    );
  }

  const chips = setupChips(props);
  return (
    <header
      class={`rh${live ? ' rh--live' : ''}`}
      data-testid="result-header"
      data-run={live ? `${live.index}-live` : String(run!.index)}
    >
      <div class="rh__line1">
        {live ? (
          <LiveCells rt={live.telemetry} units={units} index={live.index} />
        ) : (
          <>
            <Cell
              label={
                <>
                  <span class="rh__run">{`RUN ${run!.index}`}</span>
                  {isPB && (
                    <span class="chip chip--best" data-testid="chip-pb" title="Personal best">
                      PB
                    </span>
                  )}
                </>
              }
              class="rh__cell--time"
            >
              <span class={`rh__time metric${isPB ? ' rh__time--pb' : ''}`} data-testid="rh-time">
                {formatValue('time', units, run!.time, { withUnit: false })}
                <span class="rh__unit">{unitLabel('time', units)}</span>
              </span>
            </Cell>
            <Cell label="Δ best">
              <DeltaValue
                value={bestTime === null ? null : run!.time - bestTime}
                label="best"
                size="l"
                unit={unitLabel('time', units)}
              />
            </Cell>
            <Cell
              label={
                <>
                  Δ target
                  {passed && (
                    <span class="chip chip--best" data-testid="chip-target">
                      TARGET MET
                    </span>
                  )}
                </>
              }
            >
              <DeltaValue
                value={target === null ? null : run!.time - target}
                label="target"
                size="l"
                unit={unitLabel('time', units)}
              />
            </Cell>
          </>
        )}
        {runsCell}
      </div>
      <div class="rh__line2" aria-label="Setup used">
        {extra?.map((x) => (
          <span key={x.label} class={`chip chip--extra${x.tone ? ` chip--${x.tone}` : ''}`}>
            <span class="chip__label">{x.label}</span> {x.value}
          </span>
        ))}
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
        {(props.controls || (!live && (actions || (passed && onDebrief)))) && (
          <span class="rh__actions">
            {props.controls}
            {!live && actions}
            {!live && passed && onDebrief && (
              <Button variant="secondary" size="compact" onClick={() => onDebrief()}>
                Continue to debrief
              </Button>
            )}
          </span>
        )}
      </div>
    </header>
  );
}
