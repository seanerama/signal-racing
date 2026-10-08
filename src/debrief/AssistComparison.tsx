/**
 * B4L debrief: runs-to-target with and without the assist (signal.md "The comparison"), from the
 * player's own history (`LevelProgress.runsToTarget`) plus, under the demo profile, the recorded
 * unassisted attempt (labelled as such). Then the spurious-correlation note and the causal list.
 */
import type { ChannelId } from '@/engine/types';

export interface RunsToTarget {
  /** Runs to target, one entry per passed attempt. */
  values: number[];
  /** Where the numbers come from, e.g. "this browser" or "recorded attempt (demo profile)". */
  source: string;
}

export interface AssistComparisonProps {
  assisted: RunsToTarget[];
  unassisted: RunsToTarget[];
  /** The spurious-correlation finding, if raw correlation put an echo in the top five. */
  demoted: { channel: ChannelId; runLabel: string } | null;
  /** Runs the note was computed over. */
  noteRuns: number;
  causal: ChannelId[];
}

function summarise(groups: RunsToTarget[]): { value: string; detail: string } {
  const all = groups.flatMap((g) => g.values);
  if (all.length === 0) return { value: '—', detail: 'no passed attempt yet' };
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const value = Number.isInteger(mean) ? String(mean) : mean.toFixed(1);
  const detail = groups
    .filter((g) => g.values.length > 0)
    .map((g) => `${g.values.join(', ')} · ${g.source}`)
    .join('; ');
  return { value, detail };
}

export function AssistComparison(props: AssistComparisonProps) {
  const { assisted, unassisted, demoted, noteRuns, causal } = props;
  const w = summarise(assisted);
  const wo = summarise(unassisted);
  return (
    <div class="db__cmp" data-testid="assist-comparison">
      <h2 class="h2 dim db__h">Runs to target</h2>
      <div class="db__cmpgrid">
        <div class="db__cmpcell" data-testid="cmp-with">
          <span class="micro dim">WITH ASSIST</span>
          <span class="db__cmpval">
            {w.value}
            <span class="micro dim"> runs</span>
          </span>
          <span class="micro faint">{w.detail}</span>
        </div>
        <div class="db__cmpcell" data-testid="cmp-without">
          <span class="micro dim">WITHOUT</span>
          <span class="db__cmpval">
            {wo.value}
            <span class="micro dim"> runs</span>
          </span>
          <span class="micro faint">{wo.detail}</span>
        </div>
      </div>
      <p class="db__prose" data-testid="spurious-note">
        {demoted ? (
          <>
            Raw correlation alone ranked <code class="mono rich__channel">{demoted.channel}</code>{' '}
            in the top five on {demoted.runLabel}; the rule priors demoted it. With ten runs and two
            hundred channels, plenty of channels move with lap time without explaining it.
          </>
        ) : (
          `Over these ${noteRuns} runs raw correlation put no echo channel in the top five, but with ten runs and two hundred channels plenty of channels move with lap time without explaining it; the rule priors are what keep the filter useful.`
        )}
      </p>
      <p class="db__prose">
        The assist is a filter, not a decider: it ranks channels by the rules that fired, then by
        correlation with lap time, so the engineer decides faster. The channels that answered this
        track:{' '}
        {causal.map((id, i) => (
          <span key={id}>
            {i > 0 ? ', ' : ''}
            <code class="mono rich__channel">{id}</code>
          </span>
        ))}
        .
      </p>
    </div>
  );
}
