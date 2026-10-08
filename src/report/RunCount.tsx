/**
 * Run count (Stage 10; replaces the run-budget pips): there is no budget, so the top bar and the
 * result header show how many runs were made and how many hints were opened, e.g.
 * `RUNS 4 · 1 hint`. Hints are free but counted.
 */
import './report.css';

export interface RunCountProps {
  runs: number;
  hints: number;
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `RUNS 4 · 1 hint` (plain text, for labels and tests). */
export function runCountText({ runs, hints }: RunCountProps): string {
  return `RUNS ${runs} · ${plural(hints, 'hint')}`;
}

export function RunCount({ runs, hints }: RunCountProps) {
  return (
    <span
      class="runcount"
      role="img"
      aria-label={`${plural(runs, 'run')} made, ${plural(hints, 'hint')} opened`}
      data-testid="run-count"
      data-runs={runs}
      data-hints={hints}
    >
      <span class="runcount__label" aria-hidden="true">
        RUNS
      </span>
      <span class="runcount__n" aria-hidden="true">
        {runs}
      </span>
      <span class="runcount__sep" aria-hidden="true">
        ·
      </span>
      <span class="runcount__hints" aria-hidden="true">
        {plural(hints, 'hint')}
      </span>
    </span>
  );
}
