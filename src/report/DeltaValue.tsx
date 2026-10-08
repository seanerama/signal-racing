/**
 * A signed delta (design-system "Semantic"; Stage 10): colour is never the only carrier. Every
 * delta carries a sign; gains are lime with the word "faster", losses orange with "slower";
 * zero is `±0.000`, neutral. The compact `data` size (tables, strip readouts) keeps the ▼/▲
 * glyph instead of the word.
 */
import './report.css';

export interface DeltaValueProps {
  /** Seconds (or any value where negative is better). Null/NaN renders `—`. */
  value: number | null;
  /** Trailing label, e.g. `best` or `target` (read by screen readers; shown in `data` size). */
  label?: string;
  /** Decimal places (time: 3). */
  dp?: number;
  /** `xl`: the result header's Barlow metric; `l`: medium; `data`: table cells. */
  size?: 'xl' | 'l' | 'data';
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

/** The word that goes with a tone: "faster", "slower" or "even". */
export function deltaWord(tone: 'gain' | 'loss' | 'even'): string {
  return tone === 'gain' ? 'faster' : tone === 'loss' ? 'slower' : 'even';
}

export function DeltaValue({ value, label, dp = 3, size = 'l', unit }: DeltaValueProps) {
  const words = size !== 'data';
  if (value === null || !Number.isFinite(value)) {
    return (
      <span class={`delta delta--${size} delta--none`}>
        <span class="delta__num">—</span>
        {label && !words && <span class="delta__label micro">{label}</span>}
      </span>
    );
  }
  const p = deltaParts(value, dp);
  const spoken =
    p.tone === 'even'
      ? `equal to ${label ?? 'reference'}`
      : `${Math.abs(value).toFixed(dp)}${unit ? ` ${unit}` : ''} ${deltaWord(p.tone)} than ${label ?? 'reference'}`;
  return (
    <span class={`delta delta--${size} delta--${p.tone}`} aria-label={spoken} data-tone={p.tone}>
      {!words && p.glyph && (
        <span class="delta__glyph" aria-hidden="true">
          {p.glyph}
        </span>
      )}
      <span class="delta__num" aria-hidden="true">
        {p.text}
      </span>
      {unit && (
        <span class="delta__unit" aria-hidden="true">
          {unit}
        </span>
      )}
      {words && (
        <span class="delta__word" aria-hidden="true">
          {deltaWord(p.tone)}
        </span>
      )}
      {label && !words && (
        <span class="delta__label micro" aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
