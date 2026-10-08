/**
 * Level-specific debrief sections (Stage 8), composed from app state:
 * - B1L (`scoreTarget: 'compromise_gap'`): the per-segment delta table.
 * - B4L (`assist`): runs-to-target with and without the assist, from `LevelProgress.runsToTarget`
 *   and (demo profile) the re-simulated recorded attempt; the spurious-correlation note computed
 *   over the same runs the assist ranked; and the causal list.
 */
import { useMemo } from 'preact/hooks';
import { ASSIST_TOP, RULE_WEIGHT } from '@/assist/config';
import { assistChannels, isEchoChannel } from '@/assist/puzzle';
import { demotedEcho } from '@/assist/rank';
import { AssistComparison, type RunsToTarget } from '@/debrief/AssistComparison';
import { JoinTable } from '@/debrief/JoinTable';
import type { LevelConfig } from '@/levels/types';
import { units } from '@/game/prefs';
import { demoHistory } from './demo';
import { assistHistory, progress, type LevelState } from './game-store';

export function DebriefExtra({ level, st }: { level: LevelConfig; st: LevelState | null }) {
  if (level.scoreTarget === 'compromise_gap') {
    return (
      <JoinTable
        level={level}
        grid={st?.session.grid.value ?? null}
        best={st?.session.best.value ?? null}
        units={units.value}
      />
    );
  }
  if (level.assist) return <PuzzleComparison level={level} st={st} />;
  return null;
}

function PuzzleComparison({ level, st }: { level: LevelConfig; st: LevelState | null }) {
  const stored = progress.value[level.id]?.runsToTarget ?? { assisted: [], unassisted: [] };
  const demo = demoHistory.value;
  const hist = assistHistory(level.id);
  const sessionRuns = st?.session.runs.value ?? [];

  const assisted: RunsToTarget[] = [{ values: stored.assisted, source: 'your attempts' }];
  const unassisted: RunsToTarget[] = [{ values: stored.unassisted, source: 'your attempts' }];
  if (demo && demo.levelId === level.id && demo.passIndex !== null) {
    unassisted.push({ values: [demo.passIndex], source: 'recorded attempt (demo profile)' });
  }

  const pool = useMemo(() => [...hist.runs, ...sessionRuns], [hist.runs, sessionRuns]);
  const found = useMemo(
    () =>
      demotedEcho({
        runs: pool,
        channelIds: assistChannels(level),
        isEcho: isEchoChannel,
        ruleWeight: RULE_WEIGHT,
        top: ASSIST_TOP,
      }),
    [pool, level],
  );
  // Label the run the note refers to: a recorded or earlier run, or a run of this session.
  const runLabel = (n: number): string => {
    if (n > hist.runs.length) return `run ${n - hist.runs.length} of this session`;
    return n <= hist.recorded
      ? `recorded run ${n} (demo profile)`
      : `run ${n - hist.recorded} of an earlier attempt`;
  };

  return (
    <AssistComparison
      assisted={assisted}
      unassisted={unassisted}
      demoted={found ? { channel: found.channel, runLabel: runLabel(found.n) } : null}
      noteRuns={pool.length}
      causal={level.debrief.causal}
    />
  );
}
