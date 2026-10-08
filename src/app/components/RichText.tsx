/**
 * Body copy with inline channel ids: backticked ids render as mono links (UX rule 5: clicking a
 * channel id anywhere brings that strip into view) and `{var:quantity}` values are formatted
 * through the units layer, so prose reads the same as the hint panel.
 */
import type { ChannelId } from '@/engine/types';
import { renderTemplate } from '@/hints/engine';
import type { UnitSystem } from '@/units';

export interface RichTextProps {
  text: string;
  units: UnitSystem;
  vars?: Record<string, number | string>;
  onChannelClick?(id: ChannelId): void;
  class?: string;
}

export function RichText({ text, units, vars = {}, onChannelClick, class: cls }: RichTextProps) {
  const { segments } = renderTemplate(text, vars, units);
  return (
    <p class={cls}>
      {segments.map((s, i) =>
        s.kind === 'channel' ? (
          onChannelClick ? (
            <button
              key={i}
              type="button"
              class="hint__channel mono"
              onClick={() => onChannelClick(s.value)}
              title={`Show ${s.value} in the stack`}
            >
              {s.value}
            </button>
          ) : (
            <code key={i} class="rich__channel">
              {s.value}
            </code>
          )
        ) : s.kind === 'value' ? (
          <span key={i} class="hint__value mono">
            {s.value}
          </span>
        ) : (
          <span key={i}>{s.value}</span>
        ),
      )}
    </p>
  );
}
