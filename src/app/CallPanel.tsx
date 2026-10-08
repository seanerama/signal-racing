/**
 * "Make the call" (design-system "Make the call", Stage 9): a judgment prompt about a reading,
 * docked above the hint controls once the level's `call.afterRun` run has rendered. Not a modal
 * (UX rule 7): the report stays live and the player can keep reading strips while deciding.
 *
 * Three options; answering costs no runs and is recorded on the session (the debrief shows it).
 * After answering, the panel shows whether it was the call, the one-sentence why, and the
 * cross-check channels as one-click "add to stack" links. It stays until the next run.
 */
import type { ChannelId } from '@/engine/types';
import type { LevelSession, RunRecord } from '@/game/types';
import type { CallSpec, LevelConfig } from '@/levels/types';
import { artifactIndex } from '@/telemetry/run-telemetry';
import type { UnitSystem } from '@/units';
import { RichText } from './components/RichText';
import './CallPanel.css';

/** Template vars for the question: the planted reading, where and when (SI). */
export function callVars(level: LevelConfig, rec: RunRecord | undefined): Record<string, number> {
  const call = level.call;
  const art = call && (level.artifacts ?? []).find((a) => a.run === call.afterRun);
  if (!call || !art || !rec) return {};
  const rt = rec.telemetry;
  const i = artifactIndex(rt, art.at);
  return { value: rt.get(art.channel)[i] ?? NaN, at: rt.s[i] ?? NaN, t: rt.t[i] ?? NaN };
}

/**
 * Whether the panel shows: unanswered once the run exists, or answered until the next run.
 * `shown` (Stage 10) is the number of runs whose results are revealed (a run still playing back
 * is not); it defaults to every run.
 */
export function callVisible(
  call: CallSpec | undefined,
  session: LevelSession,
  shown = session.runs.value.length,
): boolean {
  if (!call) return false;
  const n = shown;
  const ans = session.call.value;
  if (!ans) return n >= call.afterRun;
  return n === ans.atRun;
}

export interface CallPanelProps {
  level: LevelConfig;
  session: LevelSession;
  units: UnitSystem;
  inStack: ReadonlySet<ChannelId>;
  onAdd(id: ChannelId): void;
  onChannelClick(id: ChannelId): void;
  /** Stage 10: runs whose results are revealed (a run playing back is not). Default: all. */
  shownRuns?: number;
}

export function CallPanel({
  level,
  session,
  units,
  inStack,
  onAdd,
  onChannelClick,
  shownRuns,
}: CallPanelProps) {
  const call = level.call;
  if (!call || !callVisible(call, session, shownRuns)) return null;
  const ans = session.call.value;
  const runs = session.runs.value;
  const vars = callVars(level, runs[call.afterRun - 1]);
  const chosen = ans ? call.options.find((o) => o.id === ans.optionId) : undefined;

  return (
    <section class="call panel" aria-label="Make the call" data-testid="call-panel">
      <header class="call__head">
        <h2 class="h2 call__title">Make the call</h2>
        <span class="meta">{`run ${call.afterRun} · free`}</span>
      </header>
      <RichText
        class="call__q"
        text={call.question}
        vars={vars}
        units={units}
        onChannelClick={onChannelClick}
      />
      <div class="call__options" role="group" aria-label="Your call">
        {call.options.map((o, i) => {
          const picked = ans?.optionId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              class={`call__opt${picked ? ` call__opt--picked call__opt--${o.correct ? 'right' : 'wrong'}` : ''}`}
              disabled={!!ans}
              aria-pressed={picked}
              data-testid={`call-opt-${o.id}`}
              onClick={() => session.answerCall(o.id)}
            >
              <span class="call__key mono">{String.fromCharCode(65 + i)}</span>
              <RichText class="call__opttext" text={o.text} units={units} />
            </button>
          );
        })}
      </div>
      {ans && chosen && (
        <div class="call__result" data-testid="call-result" aria-live="polite">
          <p
            class={`call__verdict micro ${ans.correct ? 'call__verdict--right' : 'call__verdict--wrong'}`}
          >
            {ans.correct ? '✓ The call.' : '✗ Not the call.'}
          </p>
          <RichText
            class="call__why"
            text={chosen.why}
            units={units}
            onChannelClick={onChannelClick}
          />
          {!ans.correct && (
            <RichText
              class="call__why dim"
              text={`The call: ${call.options.find((o) => o.correct)?.text ?? ''}`}
              units={units}
            />
          )}
          <div class="call__check">
            <span class="micro dim">Cross-check</span>
            {call.crossCheck.map((id) => (
              <button
                key={id}
                type="button"
                class="call__add mono"
                data-testid={`call-add-${id}`}
                disabled={inStack.has(id)}
                title={inStack.has(id) ? `${id} is in the stack` : `Add ${id} to the stack`}
                onClick={() => onAdd(id)}
              >
                {inStack.has(id) ? `✓ ${id}` : `+ ${id}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
