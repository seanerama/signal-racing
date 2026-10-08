/**
 * Brief (design-system "Other screens: Brief"; core loop step 1): a 560px modal over the
 * workbench with the concept, the levers unlocked (chips), the run budget, the target time
 * (Readout L, once the grid search has finished) and BEGIN. Reachable again from ⓘ.
 */
import type { LevelConfig } from '@/levels/types';
import { LockGlyph } from '@/report/LockGlyph';
import { LEVER_QUANTITY, LEVER_SHORT } from '@/report/ResultHeader';
import { formatValue, unitLabel, type UnitSystem } from '@/units';
import { Button } from './components/Button';
import { Modal } from './components/Modal';
import { RichText } from './components/RichText';
import './screens.css';

export interface BriefModalProps {
  level: LevelConfig;
  target: number | null;
  progress: number;
  units: UnitSystem;
  onBegin(): void;
  /** Re-opened from ⓘ after the level started: the button reads CLOSE. */
  started?: boolean;
}

export function BriefModal({ level, target, progress, units, onBegin, started }: BriefModalProps) {
  const locked = Object.entries(level.lockedLevers) as Array<[keyof typeof LEVER_SHORT, number]>;
  return (
    <Modal label={`Brief: ${level.id} ${level.title}`} onClose={onBegin} testId="brief">
      <div class="brief">
        <div class="brief__head">
          <span class="micro dim">{`${level.id} · PHASE ${level.phase}`}</span>
          <h1 class="h1">{level.title}</h1>
          <span class="h2 dim">{level.concept}</span>
        </div>
        <RichText class="brief__text" text={level.brief} units={units} />
        <dl class="brief__facts">
          <div>
            <dt class="h2 dim">Levers</dt>
            <dd class="brief__chips">
              {level.levers.map((l) => (
                <span key={l.id} class="setchip data">
                  {l.label}
                </span>
              ))}
              {locked.map(([id, v]) => (
                <span key={id} class="setchip setchip--locked data" aria-disabled="true">
                  {LEVER_SHORT[id]} {formatValue(LEVER_QUANTITY[id], units, v)}
                  <LockGlyph class="setchip__lock" />
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt class="h2 dim">Runs</dt>
            <dd class="brief__big mono" data-testid="brief-budget">
              {level.runBudget}
            </dd>
          </div>
          <div>
            <dt class="h2 dim">Target</dt>
            <dd class="brief__big mono" data-testid="brief-target">
              {target === null ? (
                <span class="micro dim">{`computing ${Math.round(progress * 100)}%`}</span>
              ) : (
                <>
                  {formatValue('time', units, target, { withUnit: false })}
                  <span class="micro dim"> {unitLabel('time', units)}</span>
                </>
              )}
            </dd>
          </div>
        </dl>
        <p class="micro faint">{`Target is the optimum from a grid search over every lever setting, plus ${(
          level.tolerance * 100
        ).toFixed(1)}%. Hints cost one run per tier.`}</p>
        <div class="brief__actions">
          <Button variant="primary" size="run" onClick={onBegin} data-autofocus data-testid="begin">
            {started ? 'Close' : 'Begin'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
