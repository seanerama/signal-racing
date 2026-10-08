/**
 * Hint body (contract 07, design-system "Hint panel"; Stage 10: hints are free): the opened
 * tiers (label, then the text with channel ids as clickable mono links), then the button that
 * opens the next tier. Opening is free but counted, so there is no confirm step. `1/2/3` open the
 * matching tier while focus is in the box.
 */
import type { JSX } from 'preact';
import { Button } from '@/app/components/Button';
import type { HintText } from '@/hints/types';
import type { HintPopoverProps } from './types';
import './report.css';

export const TIER_LABELS = ['Observe', 'Explain', 'Direct'] as const;

export function HintBody({
  hint,
  onChannelClick,
}: {
  hint: HintText;
  onChannelClick(id: string): void;
}) {
  const segs =
    hint.segments.length > 0 ? hint.segments : [{ kind: 'text' as const, value: hint.text }];
  return (
    <p class="hint__text">
      {segs.map((s, i) =>
        s.kind === 'channel' ? (
          <button
            key={i}
            type="button"
            class="hint__channel mono"
            onClick={() => onChannelClick(s.value)}
            title={`Show ${s.value} in the stack`}
          >
            {s.value}
          </button>
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

export function HintPopover({ tiersOpened, texts, onOpenNext, onChannelClick }: HintPopoverProps) {
  const next = Math.max(0, Math.min(3, tiersOpened));
  const allOpen = next >= 3;

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (!allOpen && ev.key === String(next + 1)) {
      ev.preventDefault();
      onOpenNext();
    }
  };

  return (
    <section class="hint" aria-label="Hint" onKeyDown={onKeyDown} data-testid="hint-popover">
      {texts.length === 0 && (
        <p class="hint__empty">
          Each tier points at a channel before it points at a lever. Hints are free; the count is
          kept with your score.
        </p>
      )}
      {texts.map((t, i) => (
        <div key={i} class="hint__tier">
          <h3 class="hint__label meta">
            <span class="hint__n">{i + 1}</span> {TIER_LABELS[i] ?? `Tier ${i + 1}`}
          </h3>
          <HintBody hint={t} onChannelClick={onChannelClick} />
        </div>
      ))}
      <div class="hint__actions">
        {allOpen ? (
          <span class="meta">All tiers open</span>
        ) : (
          <Button
            variant="secondary"
            size="compact"
            class="hint__open"
            onClick={onOpenNext}
            data-testid="hint-open"
            title={`Open tier ${next + 1} (${next + 1})`}
          >
            {`Open ${TIER_LABELS[next]?.toLowerCase() ?? 'tier'}`}
          </Button>
        )}
      </div>
    </section>
  );
}
