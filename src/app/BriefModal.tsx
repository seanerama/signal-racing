/**
 * Brief (design-system "Other screens: Brief"; core loop step 1; Stage 10 style guide): a
 * briefing screen in a modal over the workbench. Mission label, the level title as the
 * briefing display title (Barlow Condensed 700), the concept, the brief, then the facts:
 * levers unlocked (chips), the target time (a large metric, once the grid search has finished)
 * and the scoring (unlimited runs; score = runs to target; hints free, counted). Then BEGIN.
 * Reachable again from ⓘ.
 */
import { DISCLAIMER } from '@/game/disclaimer';
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
    <Modal label={`Brief: ${level.id} ${level.title}`} onClose={onBegin} testId="brief" width={720}>
      <div class="brief">
        <div class="brief__head">
          <span class="meta">{`${level.id} · Phase ${level.phase} · Brief`}</span>
          <h1 class="display brief__title">{level.title}</h1>
          <p class="brief__concept">{level.concept}</p>
        </div>
        <RichText class="brief__text" text={level.brief} units={units} />
        <dl class="brief__facts">
          <div class="brief__fact brief__fact--levers">
            <dt class="meta">Levers</dt>
            <dd class="brief__chips">
              {level.levers.map((l) => (
                <span key={l.id} class="brief__lever">
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
          <div class="brief__fact">
            <dt class="meta">Target</dt>
            <dd class="brief__big metric" data-testid="brief-target">
              {target === null ? (
                <span class="brief__computing">{`computing ${Math.round(progress * 100)}%`}</span>
              ) : (
                <>
                  {formatValue('time', units, target, { withUnit: false })}
                  <span class="brief__unit"> {unitLabel('time', units)}</span>
                </>
              )}
            </dd>
          </div>
          <div class="brief__fact">
            <dt class="meta">Score</dt>
            <dd class="brief__score" data-testid="brief-budget">
              Runs to target
              <span class="dim">unlimited runs · free hints</span>
            </dd>
          </div>
        </dl>
        <p class="brief__note">{`The target is the optimum from a grid search over every lever setting, plus ${(
          level.tolerance * 100
        ).toFixed(1)}%. Fewer runs is a better score; hints are counted with it.`}</p>
        {level.assist && (
          <p class="micro brief__disclaimer" data-testid="disclaimer-brief">
            {DISCLAIMER}
          </p>
        )}
        <div class="brief__actions">
          <Button variant="primary" size="run" onClick={onBegin} data-autofocus data-testid="begin">
            {started ? 'Close' : 'Begin →'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
