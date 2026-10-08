/**
 * Level select (design-system "Other screens"; Stage 10 style guide): a briefing-style title in
 * Barlow Condensed, then the session sheet as a table in one flat panel. Columns `#`, level,
 * concept, best score (runs to target · hints), best time, status (locked / open / passed /
 * moved on). Phases are separated by a labelled rule. There is no run budget: runs are unlimited
 * and the score is the number of runs it took to meet the target.
 */
import { LEVELS } from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { formatValue, type UnitSystem } from '@/units';
import { progress, unlocked } from './game-store';
import { DISCLAIMER } from '@/game/disclaimer';
import { MODEL_PATH, levelPath, navigate } from './router';
import './screens.css';

type Status = 'locked' | 'open' | 'passed' | 'done';

function statusOf(level: LevelConfig): Status {
  const p = progress.value[level.id];
  if (!unlocked(level.id)) return 'locked';
  if (p?.passed) return 'passed';
  if (p && p.runs > 0) return 'done';
  return 'open';
}

const STATUS_LABEL: Record<Status, string> = {
  locked: 'locked',
  open: 'open',
  passed: 'passed',
  done: 'in progress',
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function LevelSelect({ units }: { units: UnitSystem }) {
  const phases: Array<'A' | 'B'> = ['A', 'B'];
  return (
    <section class="select" data-testid="level-select">
      <header class="select__head">
        <span class="meta">Session sheet</span>
        <h1 class="display select__title">Signal</h1>
        <p class="select__lede">
          Each level adds one effect and one lever. Meet the target time in as few runs as you can.
          Runs are unlimited and hints are free; both are counted.
        </p>
      </header>
      <div class="select__panel panel">
        <table class="sheet">
          <thead>
            <tr>
              <th class="sheet__num">#</th>
              <th>Level</th>
              <th>Concept</th>
              <th>Best score</th>
              <th class="sheet__r">Best time</th>
              <th>Status</th>
            </tr>
          </thead>
          {phases.map((phase) => {
            const rows = LEVELS.filter((l) => l.phase === phase);
            if (rows.length === 0) return null;
            return (
              <tbody key={phase}>
                <tr class="sheet__phase">
                  <td colSpan={6} class="meta">
                    {phase === 'A' ? 'Phase A · Segments' : 'Phase B · Assembly'}
                  </td>
                </tr>
                {rows.map((l) => {
                  const st = statusOf(l);
                  const p = progress.value[l.id];
                  const go = () => {
                    if (st !== 'locked') navigate(levelPath(l.id));
                  };
                  return (
                    <tr
                      key={l.id}
                      class={`sheet__row sheet__row--${st}`}
                      data-testid={`level-row-${l.id}`}
                      data-status={st}
                      aria-disabled={st === 'locked' || undefined}
                      onClick={go}
                    >
                      <td class="sheet__num mono">{l.id}</td>
                      <td>
                        {st === 'locked' ? (
                          <span class="faint">{l.title}</span>
                        ) : (
                          <a
                            class="sheet__link"
                            href={`#${levelPath(l.id)}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {l.title}
                          </a>
                        )}
                      </td>
                      <td class="dim">{l.concept}</td>
                      <td data-testid={`best-score-${l.id}`}>
                        {p && p.bestRunsToTarget !== null ? (
                          <span class="sheet__score">
                            <span class="mono">{plural(p.bestRunsToTarget, 'run')}</span>
                            <span class="dim">{` · ${plural(p.hintsOpenedThen ?? 0, 'hint')}`}</span>
                          </span>
                        ) : (
                          <span class="faint mono">—</span>
                        )}
                      </td>
                      <td class="sheet__r mono" data-testid={`best-time-${l.id}`}>
                        {p?.bestTime != null ? formatValue('time', units, p.bestTime) : '—'}
                      </td>
                      <td>
                        <span class={`status status--${st}`} data-testid={`status-${l.id}`}>
                          {STATUS_LABEL[st]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <footer class="select__foot">
        <p class="micro dim">⌘K jumps anywhere · P projector mode · U units · ? shortcuts</p>
        <p>
          <a class="sheet__link" href={`#${MODEL_PATH}`} data-testid="model-link">
            How this is modelled
          </a>
        </p>
        <p class="micro select__disclaimer" data-testid="disclaimer-select">
          {DISCLAIMER}
        </p>
      </footer>
    </section>
  );
}
