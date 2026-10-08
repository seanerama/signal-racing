/**
 * Hint panel (contract 07, design-system "Hint panel"): the opened tiers (label in H2, text in
 * Body with channel ids as clickable mono links), then the button that opens the next tier.
 *
 * Opening costs runs, so it uses the armed-confirm pattern inside the button, never a dialog:
 * the first click arms it (`OPEN −1 RUN?`), the second commits. Blur or Esc disarms. `1/2/3`
 * arm/commit the matching tier while focus is in the panel. Disabled when `runsLeft < cost`.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/app/components/Button';
import type { HintText } from '@/hints/types';
import type { HintPopoverProps } from './types';
import './report.css';

export const TIER_LABELS = ['Observe', 'Explain', 'Direct'] as const;

function HintBody({ hint, onChannelClick }: { hint: HintText; onChannelClick(id: string): void }) {
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

export function HintPopover({
  tiersOpened,
  cost,
  runsLeft,
  texts,
  onOpenNext,
  onChannelClick,
}: HintPopoverProps) {
  const [armed, setArmed] = useState(false);
  const next = Math.max(0, Math.min(3, tiersOpened));
  const allOpen = next >= 3;
  const nextCost = allOpen ? 0 : cost[next as 0 | 1 | 2];
  const affordable = runsLeft >= nextCost;

  // A tier opening (or the budget changing) disarms.
  useEffect(() => setArmed(false), [tiersOpened, runsLeft]);

  const press = () => {
    if (allOpen || !affordable) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onOpenNext();
  };

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (ev.key === 'Escape' && armed) {
      ev.stopPropagation();
      setArmed(false);
      return;
    }
    if (!allOpen && ev.key === String(next + 1)) {
      ev.preventDefault();
      press();
    }
  };

  const runsWord = (n: number) => `RUN${n === 1 ? '' : 'S'}`;

  return (
    <section class="hint" aria-label="Hint" onKeyDown={onKeyDown} data-testid="hint-popover">
      {texts.length === 0 && (
        <p class="hint__empty">
          Hints cost runs. Each tier points at a channel before it points at a lever.
        </p>
      )}
      {texts.map((t, i) => (
        <div key={i} class="hint__tier">
          <h3 class="h2 hint__label">
            <span class="micro faint">{i + 1}</span> {TIER_LABELS[i] ?? `Tier ${i + 1}`}
          </h3>
          <HintBody hint={t} onChannelClick={onChannelClick} />
        </div>
      ))}
      <div class="hint__actions">
        {allOpen ? (
          <span class="micro faint">All tiers open.</span>
        ) : (
          <>
            <Button
              variant="hint"
              size="default"
              class={armed ? 'hint__open hint__open--armed' : 'hint__open'}
              cost={armed ? undefined : nextCost}
              disabled={!affordable}
              aria-describedby={!affordable ? 'hint-unaffordable' : undefined}
              onClick={press}
              onBlur={() => setArmed(false)}
              data-testid="hint-open"
              data-armed={armed || undefined}
            >
              {armed
                ? `OPEN −${nextCost} ${runsWord(nextCost)}?`
                : `Open ${TIER_LABELS[next]?.toLowerCase() ?? 'tier'}`}
            </Button>
            {!affordable && (
              <span id="hint-unaffordable" class="micro faint">
                {`Needs ${nextCost} ${runsWord(nextCost).toLowerCase()}; ${runsLeft} left.`}
              </span>
            )}
            {armed && <span class="micro dim">Click again to confirm. Esc cancels.</span>}
          </>
        )}
      </div>
    </section>
  );
}
