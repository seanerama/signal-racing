/**
 * The Puzzle assist block (design-system "Puzzle assist"), docked in the channel table's `header`
 * slot. A toggle (off by default); when on, five rows `rank · channel · r (signed) · reason`, each
 * with "add to stack". Styled as a filter, not an oracle: the same type, weight and row height as
 * the table under it, no accent colour, no confidence language, and a footer that says what it
 * ranks and over how many runs. It names channels only, never a lever or a value.
 *
 * Pure presentation: the ranking comes in as `rows` (`src/assist/rank.ts`).
 */
import type { ChannelId } from '@/engine/types';
import type { AssistRow } from '@/assist/rank';
import './AssistBlock.css';

export interface AssistBlockProps {
  on: boolean;
  onToggle(next: boolean): void;
  /** Ranked rows; empty while there are too few runs. */
  rows: AssistRow[];
  /** Finished runs the ranking reads, by source. */
  counts: { session: number; recorded: number; past: number };
  minRuns: number;
  inStack: ReadonlySet<ChannelId>;
  onAdd(id: ChannelId): void;
  onChannelClick(id: ChannelId): void;
}

function fmtR(r: number): string {
  const sign = r > 0 ? '+' : r < 0 ? '−' : ' ';
  return `${sign}${Math.abs(r).toFixed(2)}`;
}

export function AssistBlock(props: AssistBlockProps) {
  const { on, onToggle, rows, counts, minRuns, inStack, onAdd, onChannelClick } = props;
  const total = counts.session + counts.recorded + counts.past;
  const sources = [
    `${counts.session} this session`,
    ...(counts.past ? [`${counts.past} earlier`] : []),
    ...(counts.recorded ? [`${counts.recorded} recorded (demo profile)`] : []),
  ];
  return (
    <section class={`as${on ? ' as--on' : ''}`} aria-label="Assist" data-testid="assist">
      <div class="as__bar">
        <h3 class="h2 dim as__title">Assist</h3>
        <label class="as__toggle data">
          <input
            type="checkbox"
            role="switch"
            checked={on}
            aria-checked={on}
            onChange={(e) => onToggle(e.currentTarget.checked)}
            data-testid="assist-toggle"
          />
          <span class="as__track" aria-hidden="true">
            <span class="as__knob" />
          </span>
          <span class="micro">{on ? 'ON' : 'OFF'}</span>
        </label>
        <span class="micro faint as__what">filter · rules first, then |r| with lap time</span>
      </div>
      {!on ? null : rows.length === 0 ? (
        <p class="as__empty data faint" data-testid="assist-needs">
          {`Needs ${minRuns} runs (${total} so far).`}
        </p>
      ) : (
        <>
          <table class="as__table data" data-testid="assist-rows">
            <thead>
              <tr class="micro faint">
                <th class="as__rank" scope="col">
                  #
                </th>
                <th scope="col">channel</th>
                <th class="as__r" scope="col">
                  r
                </th>
                <th scope="col">reason</th>
                <th scope="col">
                  <span class="visually-hidden">Stack</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const stacked = inStack.has(row.channel);
                return (
                  <tr key={row.channel} class="as__row" data-channel={row.channel}>
                    <td class="as__rank faint">{i + 1}</td>
                    <th scope="row" class="as__id">
                      <button
                        type="button"
                        class="as__link"
                        onClick={() => onChannelClick(row.channel)}
                        title={`Show ${row.channel}`}
                      >
                        {row.channel}
                      </button>
                    </th>
                    <td class="as__r" title={`Pearson r with lap time: ${row.r.toFixed(4)}`}>
                      {fmtR(row.r)}
                    </td>
                    <td class="as__reason dim" title={row.reason}>
                      {row.reason}
                    </td>
                    <td class="as__add">
                      <button
                        type="button"
                        class="as__addbtn micro"
                        disabled={stacked}
                        onClick={() => onAdd(row.channel)}
                        aria-label={
                          stacked ? `${row.channel} is in the stack` : `Add ${row.channel} to stack`
                        }
                      >
                        {stacked ? 'in stack' : '+ stack'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="as__foot micro faint" data-testid="assist-foot">
            {`${total} runs: ${sources.join(' · ')}. Correlation is not cause.`}
          </p>
        </>
      )}
    </section>
  );
}
