/**
 * Hint controls (design-system "Hint panel" + "Buttons: hint tier"): `HINT 1 2 3` tier buttons
 * at the foot of the setup panel, and the Stage 4 `HintPopover` anchored above them. Opened tiers
 * show pressed, later tiers are disabled until earlier ones are open. A tier button (or `H`)
 * toggles the popover; opening a tier always goes through the popover's armed-confirm button.
 */
import { useEffect, useRef } from 'preact/hooks';
import { Button } from '@/app/components/Button';
import type { ChannelId } from '@/engine/types';
import type { HintText } from '@/hints/types';
import { HintPopover } from '@/report/HintPopover';
import './setup.css';

export interface HintControlsProps {
  /** Whether the latest run has a hint to give. */
  available: boolean;
  tiersOpened: number;
  cost: [number, number, number];
  runsLeft: number;
  texts: HintText[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpenNext(): void;
  onChannelClick(id: ChannelId): void;
  /** Why there is no hint (no run yet, or nothing fired). */
  emptyReason: string;
}

export function HintControls({
  available,
  tiersOpened,
  cost,
  runsLeft,
  texts,
  open,
  onOpenChange,
  onOpenNext,
  onChannelClick,
  emptyReason,
}: HintControlsProps) {
  const popRef = useRef<HTMLDivElement>(null);

  // Opening the popover moves focus into it, so 1/2/3 and Esc work straight away.
  useEffect(() => {
    if (!open) return;
    const btn = popRef.current?.querySelector<HTMLButtonElement>('[data-testid="hint-open"]');
    (btn ?? popRef.current)?.focus();
  }, [open]);

  return (
    <div class="hintctl">
      {open && (
        <div
          ref={popRef}
          class="hintctl__pop"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onOpenChange(false);
            }
          }}
        >
          {available ? (
            <HintPopover
              tiersOpened={tiersOpened}
              cost={cost}
              runsLeft={runsLeft}
              texts={texts}
              onOpenNext={onOpenNext}
              onChannelClick={onChannelClick}
            />
          ) : (
            <section class="hint" aria-label="Hint" data-testid="hint-popover">
              <p class="hint__empty">{emptyReason}</p>
            </section>
          )}
        </div>
      )}
      <div class="hintctl__row" role="group" aria-label="Hint tiers">
        <span class="h2 dim hintctl__label">Hint</span>
        {[0, 1, 2].map((i) => (
          <Button
            key={i}
            variant="hint"
            size="compact"
            pressed={i < tiersOpened}
            disabled={!available || i > tiersOpened}
            aria-expanded={open}
            onClick={() => onOpenChange(!open)}
            data-testid={`hint-tier-${i + 1}`}
            title={i < tiersOpened ? 'Opened' : `Costs ${cost[i as 0 | 1 | 2]} run`}
          >
            {String(i + 1)}
          </Button>
        ))}
        <span class="micro faint hintctl__key" aria-hidden="true">
          H
        </span>
      </div>
    </div>
  );
}
