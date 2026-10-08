/**
 * Run budget pips (design-system "Run budget pips"): `■■■■□□`. Filled = runs remaining
 * (`--text`), hollow = used by runs, struck diagonal in `--warn` = spent on hints.
 */
import type { RunPipsProps } from './types';
import './report.css';

export type PipKind = 'left' | 'run' | 'hint';

/** Pip sequence: remaining first, then runs used, then hint-spent. Never longer than `budget`. */
export function pipKinds({ budget, usedByRuns, usedByHints }: RunPipsProps): PipKind[] {
  const b = Math.max(0, Math.floor(budget));
  const hints = Math.min(b, Math.max(0, Math.floor(usedByHints)));
  const runs = Math.min(b - hints, Math.max(0, Math.floor(usedByRuns)));
  const left = b - hints - runs;
  return [
    ...Array<PipKind>(left).fill('left'),
    ...Array<PipKind>(runs).fill('run'),
    ...Array<PipKind>(hints).fill('hint'),
  ];
}

export function RunPips(props: RunPipsProps) {
  const kinds = pipKinds(props);
  const left = kinds.filter((k) => k === 'left').length;
  const hints = kinds.filter((k) => k === 'hint').length;
  const label =
    `${left} of ${props.budget} runs left` + (hints > 0 ? `, ${hints} spent on hints` : '');
  return (
    <span class="pips" role="img" aria-label={label} data-testid="run-pips">
      <span class="pips__row" aria-hidden="true">
        {kinds.map((k, i) => (
          <span key={i} class={`pip pip--${k}`} data-kind={k} />
        ))}
      </span>
      <span class="pips__label micro" aria-hidden="true">
        {`${left}/${props.budget} runs`}
      </span>
    </span>
  );
}
