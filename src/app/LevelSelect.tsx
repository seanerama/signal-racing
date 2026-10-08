/**
 * Level select (design-system "Other screens"): a session-sheet table, not cards. Columns `#`,
 * level, concept, runs, best score (pips), best time, status (locked / open / passed in
 * `--best`). Phases are separated by a 1px `--rule` with a micro-caps label.
 */
import { LEVELS } from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { RunPips } from '@/report/RunPips';
import { formatValue, type UnitSystem } from '@/units';
import { progress, unlocked } from './game-store';
import { levelPath, navigate } from './router';
import './screens.css';

type Status = 'locked' | 'open' | 'passed' | 'done';

function statusOf(level: LevelConfig): Status {
  const p = progress.value[level.id];
  if (!unlocked(level.id)) return 'locked';
  if (p?.passed) return 'passed';
  if (p && p.bestScore !== null) return 'done';
  return 'open';
}

const STATUS_LABEL: Record<Status, string> = {
  locked: 'locked',
  open: 'open',
  passed: 'passed',
  done: 'not passed',
};

export function LevelSelect({ units }: { units: UnitSystem }) {
  const phases: Array<'A' | 'B'> = ['A', 'B'];
  return (
    <section class="select" data-testid="level-select">
      <header class="select__head">
        <h1 class="h1">Session sheet</h1>
        <p class="dim">
          Each level adds one effect and one lever. Hit the target time in as few runs as you can;
          hints cost runs.
        </p>
      </header>
      <table class="sheet">
        <thead>
          <tr>
            <th class="sheet__num">#</th>
            <th>Level</th>
            <th>Concept</th>
            <th class="sheet__r">Runs</th>
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
                <td colSpan={7} class="micro dim">
                  {phase === 'A' ? 'PHASE A · SEGMENTS' : 'PHASE B · ASSEMBLY'}
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
                    <td class="sheet__r mono">{l.runBudget}</td>
                    <td>
                      {p && p.bestScore !== null ? (
                        <RunPips
                          budget={l.runBudget}
                          usedByRuns={l.runBudget - p.bestScore}
                          usedByHints={0}
                        />
                      ) : (
                        <span class="faint mono">—</span>
                      )}
                    </td>
                    <td class="sheet__r mono" data-testid={`best-time-${l.id}`}>
                      {p?.bestTime != null ? formatValue('time', units, p.bestTime) : '—'}
                    </td>
                    <td>
                      <span class={`status status--${st} micro`} data-testid={`status-${l.id}`}>
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
      <p class="micro faint select__foot">
        ⌘K jumps anywhere · P projector mode · U units · ? shortcuts
      </p>
    </section>
  );
}
