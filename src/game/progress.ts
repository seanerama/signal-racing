/**
 * Scoring and progression (contract 06; signal.md "Scoring and progression"), persisted at
 * `signal.v1.progress`. Corrupt or foreign storage falls back to empty progress.
 *
 * - Score = runs left at the moment of passing (hint tiers opened before that already reduced
 *   it); 0 if not passed.
 * - A level counts as completed once a result with status `passed` or `exhausted` is recorded
 *   (`bestScore` becomes non-null). Completing a level unlocks the next one whatever the score,
 *   so nobody is stuck; B4L therefore unlocks after B1L regardless of score.
 */
import type { LevelId } from '@/levels/types';
import { LEVELS } from '@/levels/index';
import { load, save } from '@/persist/storage';
import { runPasses, scoreAtPass } from './session';
import type { LevelProgress, LevelSession } from './types';

export const PROGRESS_KEY = 'progress';
export const PROGRESS_VERSION = 1;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown): x is number | null => x === null || isNum(x);
const isNumArray = (x: unknown): x is number[] => Array.isArray(x) && x.every(isNum);

/** Keeps a stored entry only if it has the right shape. */
function sanitizeEntry(x: unknown): LevelProgress | null {
  if (typeof x !== 'object' || x === null) return null;
  const e = x as Record<string, unknown>;
  if (typeof e.passed !== 'boolean' || !isNumOrNull(e.bestScore) || !isNumOrNull(e.bestTime))
    return null;
  if (!isNum(e.attempts)) return null;
  const out: LevelProgress = {
    passed: e.passed,
    bestScore: e.bestScore,
    bestTime: e.bestTime,
    attempts: e.attempts,
  };
  if (isNumArray(e.segmentBests)) out.segmentBests = e.segmentBests;
  const rt = e.runsToTarget as Record<string, unknown> | undefined;
  if (rt && isNumArray(rt.assisted) && isNumArray(rt.unassisted)) {
    out.runsToTarget = { assisted: rt.assisted, unassisted: rt.unassisted };
  }
  return out;
}

export function getProgress(): Record<LevelId, LevelProgress> {
  const raw = load<unknown>(PROGRESS_KEY, PROGRESS_VERSION, {});
  const out = {} as Record<LevelId, LevelProgress>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = sanitizeEntry(entry);
    if (e) out[id as LevelId] = e;
  }
  return out;
}

/** Runs left at the moment of passing; 0 if not passed. */
export function scoreOf(session: LevelSession): number {
  if (session.status.value !== 'passed') return 0;
  return scoreAtPass(session) ?? session.runsLeft.value;
}

/** Folds a session into the stored progress for `levelId`. */
export function recordResult(levelId: LevelId, session: LevelSession): void {
  const all = getProgress();
  const prev: LevelProgress = all[levelId] ?? {
    passed: false,
    bestScore: null,
    bestTime: null,
    attempts: 0,
  };
  const status = session.status.value;
  const runs = session.runs.value;
  const finishedRuns = runs.filter((r) => r.outcome.finished);
  const next: LevelProgress = { ...prev, attempts: prev.attempts + 1 };

  if (status === 'passed') next.passed = true;
  if (status === 'passed' || status === 'exhausted') {
    next.bestScore = Math.max(prev.bestScore ?? 0, scoreOf(session));
  }
  for (const r of finishedRuns) {
    if (next.bestTime === null || r.outcome.totalTime < next.bestTime) {
      next.bestTime = r.outcome.totalTime;
    }
    const segs = r.outcome.segmentTimes;
    const bests = next.segmentBests ? [...next.segmentBests] : segs.map(() => Infinity);
    segs.forEach((t, i) => {
      if (t < (bests[i] ?? Infinity)) bests[i] = t;
    });
    next.segmentBests = bests;
  }
  if (session.level.assist && status === 'passed') {
    const grid = session.grid.value;
    const first = grid ? runs.find((r) => runPasses(session.level, r, grid)) : undefined;
    if (first) {
      const rt = next.runsToTarget ?? { assisted: [], unassisted: [] };
      next.runsToTarget = first.assistOn
        ? { ...rt, assisted: [...rt.assisted, first.index] }
        : { ...rt, unassisted: [...rt.unassisted, first.index] };
    }
  }
  save(PROGRESS_KEY, PROGRESS_VERSION, { ...all, [levelId]: next });
}

export function isUnlocked(levelId: LevelId): boolean {
  const idx = LEVELS.findIndex((l) => l.id === levelId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const prevId = LEVELS[idx - 1]?.id;
  const prev = prevId ? getProgress()[prevId] : undefined;
  return !!prev && (prev.passed || prev.bestScore !== null);
}
