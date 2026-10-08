/**
 * The hint box (Stage 10; design-system "Hint panel"): a docked panel in the setup column, not
 * a popover, so it never covers the strip labels. It has a close (×) button and, when closed, a
 * one-line reopen control; `H` toggles it. When closed and the latest run fired a rule the
 * previous run did not, the reopen control reads `HINT · n new`. Hints are free but counted:
 * the header reads `free · n opened`.
 *
 * While a new run is still playing back, the box says so; its hints appear with the results.
 */
import { useEffect, useRef } from 'preact/hooks';
import type { ChannelId } from '@/engine/types';
import type { HintText } from '@/hints/types';
import { HintPopover } from '@/report/HintPopover';
import { plural } from '@/report/RunCount';
import './setup.css';

export interface HintControlsProps {
  /** Whether the latest (revealed) run has a hint to give. */
  available: boolean;
  tiersOpened: number;
  texts: HintText[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpenNext(): void;
  onChannelClick(id: ChannelId): void;
  /** Why there is no hint (no run yet, or nothing fired). */
  emptyReason: string;
  /** Rules that fired on the latest run but not on the one before. */
  newCount?: number;
  /** Hint tiers opened this session. */
  hintsOpened?: number;
  /** A new run is playing back: its hints appear at the finish. */
  pending?: boolean;
}

export function HintControls({
  available,
  tiersOpened,
  texts,
  open,
  onOpenChange,
  onOpenNext,
  onChannelClick,
  emptyReason,
  newCount = 0,
  hintsOpened = 0,
  pending = false,
}: HintControlsProps) {
  const boxRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);

  // Opening the box (H or the reopen control) moves focus into it, so 1/2/3 work straight away.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const btn = boxRef.current?.querySelector<HTMLButtonElement>('[data-testid="hint-open"]');
      (btn ?? boxRef.current)?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        class={`hintbar${newCount > 0 ? ' hintbar--new' : ''}`}
        onClick={() => onOpenChange(true)}
        aria-expanded="false"
        data-testid="hint-reopen"
        title="Open the hint box (H)"
      >
        <span class="hintbar__label">Hint</span>
        {newCount > 0 && (
          <span class="hintbar__new" data-testid="hint-new">{`· ${newCount} new`}</span>
        )}
        <span class="hintbar__count meta">{`${plural(hintsOpened, 'hint')} opened`}</span>
        <kbd class="hintbar__key">H</kbd>
      </button>
    );
  }

  return (
    <section
      ref={boxRef}
      class="hintbox panel"
      aria-label="Hint box"
      tabIndex={-1}
      data-testid="hint-box"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      <header class="hintbox__head">
        <h2 class="h2">Hint</h2>
        <span class="meta hintbox__free">{`free · ${hintsOpened} opened`}</span>
        <button
          type="button"
          class="hintbox__close"
          aria-label="Close the hint box"
          title="Close (H)"
          onClick={() => onOpenChange(false)}
          data-testid="hint-close"
        >
          ×
        </button>
      </header>
      {pending ? (
        <p class="hint__empty" data-testid="hint-pending">
          The run is playing back. Hints read it when it finishes.
        </p>
      ) : available ? (
        <HintPopover
          tiersOpened={tiersOpened}
          texts={texts}
          onOpenNext={onOpenNext}
          onChannelClick={onChannelClick}
        />
      ) : (
        <section class="hint" aria-label="Hint" data-testid="hint-popover">
          <p class="hint__empty">{emptyReason}</p>
        </section>
      )}
    </section>
  );
}
