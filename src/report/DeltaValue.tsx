/**
 * A signed delta with glyph and semantic colour (design-system "Semantic"): colour is never the
 * only carrier. Negative (faster) = `▼ −0.142` in `--gain`; positive (slower) = `▲ +0.087` in
 * `--loss`; zero = `±0.000`, neutral.
 */
import './report.css';

export interface DeltaValueProps {
  /** Seconds (or any value where negative is better). Null/NaN renders `—`. */
  value: number | null;
  /** Trailing label, e.g. `best` or `target`. */
  label?: string;
  /** Decimal places (time: 3). */
  dp?: number;
  size?: 'l' | 'data';
  /** Text unit after the number, e.g. `s`. */
  unit?: string;
}

export function deltaParts(
  value: number,
  dp = 3,
): { glyph: string; text: string; tone: 'gain' | 'loss' | 'even' } {
  const rounded = Number(value.toFixed(dp));
  if (rounded === 0) return { glyph: '', text: `±${(0).toFixed(dp)}`, tone: 'even' };
  const abs = Math.abs(value).toFixed(dp);
  return value < 0
    ? { glyph: '▼', text: `−${abs}`, tone: 'gain' }
    : { glyph: '▲', text: `+${abs}`, tone: 'loss' };
}

export function DeltaValue({ value, label, dp = 3, size = 'l', unit }: DeltaValueProps) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span class={`delta delta--${size} delta--none`}>
        <span class="delta__num">—</span>
        {label && <span class="delta__label micro">{label}</span>}
      </span>
    );
  }
  const p = deltaParts(value, dp);
  const spoken =
    p.tone === 'even'
      ? `equal to ${label ?? 'reference'}`
      : `${Math.abs(value).toFixed(dp)}${unit ? ` ${unit}` : ''} ${p.tone === 'gain' ? 'faster than' : 'slower than'} ${label ?? 'reference'}`;
  return (
    <span class={`delta delta--${size} delta--${p.tone}`} aria-label={spoken} data-tone={p.tone}>
      {p.glyph && (
        <span class="delta__glyph" aria-hidden="true">
          {p.glyph}
        </span>
      )}
      <span class="delta__num" aria-hidden="true">
        {p.text}
      </span>
      {label && (
        <span class="delta__label micro" aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
