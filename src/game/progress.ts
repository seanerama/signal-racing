/**
 * Scoring and progression (contract 06; Stage 10 rules), persisted at `signal.v1.progress`
 * (envelope version 2). Corrupt or foreign storage falls back to empty progress.
 *
 * - Score = **runs to target**: the index of the first run that met the cut, lower is better,
 *   with the hints opened by then (`Target met in 4 runs · 1 hint`). Hints are free, so they are
 *   shown, not subtracted. The best score keeps the fewest runs (ties: fewer hints).
 * - Results are folded in after every run (`recordResult` is incremental per session), so the
 *   run count that unlocks the next level is always current.
 * - Unlocking: the next level opens when the previous one is passed, or after
 *   `UNLOCK_AFTER_RUNS` runs on it without passing ("you can move on"), so nobody is stuck. The
 *   Puzzle (B4L) opens after any run on B1L, regardless of the result.
 * - Migration: version-1 progress (score = runs left) is converted on first read; old scores are
 *   discarded with a `warn`, while passes, best times, segment bests and the B4L runs-to-target
 *   history are kept. A v1 level that was completed (passed or exhausted) keeps the next level
 *   unlocked.
 */
import { log } from '@/app/log';
import type { LevelId } from '@/levels/types';
import { LEVELS } from '@/levels/index';
import { load, save } from '@/persist/storage';
import { firstPassIndex } from './session';
import type { LevelProgress, LevelSession } from './types';

export const PROGRESS_KEY = 'progress';
export const PROGRESS_VERSION = 2;
/** Runs on a level without passing after which the next level unlocks anyway. */
export const UNLOCK_AFTER_RUNS = 5;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown): x is number | null => x === null || isNum(x);
const isNumArray = (x: unknown): x is number[] => Array.isArray(x) && x.every(isNum);

function extras(e: Record<string, unknown>, out: LevelProgress): LevelProgress {
  if (isNumArray(e.segmentBests)) out.segmentBests = e.segmentBests;
  const rt = e.runsToTarget as Record<string, unknown> | undefined;
  if (rt && isNumArray(rt.assisted) && isNumArray(rt.unassisted)) {
    out.runsToTarget = { assisted: rt.assisted, unassisted: rt.unassisted };
  }
  return out;
}

/** Keeps a stored v2 entry only if it has the right shape. */
function sanitizeEntry(x: unknown): LevelProgress | null {
  if (typeof x !== 'object' || x === null) return null;
  const e = x as Record<string, unknown>;
  if (typeof e.passed !== 'boolean' || !isNumOrNull(e.bestTime)) return null;
  if (!isNumOrNull(e.bestRunsToTarget) || !isNumOrNull(e.hintsOpenedThen)) return null;
  if (!isNum(e.attempts) || !isNum(e.runs)) return null;
  return extras(e, {
    passed: e.passed,
    bestRunsToTarget: e.bestRunsToTarget,
    hintsOpenedThen: e.hintsOpenedThen,
    bestTime: e.bestTime,
    attempts: e.attempts,
    runs: e.runs,
  });
}

/** A v1 entry (`bestScore` = runs left) → v2, score discarded. Null if malformed. */
export function migrateV1Entry(x: unknown): LevelProgress | null {
  if (typeof x !== 'object' || x === null) return null;
  const e = x as Record<string, unknown>;
  if (typeof e.passed !== 'boolean' || !isNumOrNull(e.bestScore) || !isNumOrNull(e.bestTime))
    return null;
  if (!isNum(e.attempts)) return null;
  const completed = e.passed || e.bestScore !== null;
  return extras(e, {
    passed: e.passed,
    bestRunsToTarget: null,
    hintsOpenedThen: null,
    bestTime: e.bestTime,
    attempts: e.attempts,
    // A completed v1 level unlocked the next one; keep it that way.
    runs: completed ? UNLOCK_AFTER_RUNS : 0,
  });
}

function sanitizeAll(
  raw: unknown,
  each: (x: unknown) => LevelProgress | null,
): Record<LevelId, LevelProgress> {
  const out = {} as Record<LevelId, LevelProgress>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = each(entry);
    if (e) out[id as LevelId] = e;
  }
  return out;
}

export function getProgress(): Record<LevelId, LevelProgress> {
  const raw = load<unknown>(PROGRESS_KEY, PROGRESS_VERSION, null);
  if (raw !== null) return sanitizeAll(raw, sanitizeEntry);
  const v1 = load<unknown>(PROGRESS_KEY, 1, null);
  if (v1 === null) return {} as Record<LevelId, LevelProgress>;
  const migrated = sanitizeAll(v1, migrateV1Entry);
  log.warn(
    'progress: migrated version 1 to 2; scores (runs left) discarded, runs to target starts fresh',
  );
  save(PROGRESS_KEY, PROGRESS_VERSION, migrated);
  return migrated;
}

/** Runs to target for a session (the score); null if it has not met the target. */
export function scoreOf(session: LevelSession): number | null {
  return (
    session.runsToTarget?.value ??
    firstPassIndex(session.level, session.runs.value, session.grid.value)
  );
}

/** What has already been folded into progress, per session. */
const folded = new WeakMap<LevelSession, { runs: number; passed: boolean }>();

/**
 * Folds a session into the stored progress for `levelId`. Incremental and idempotent per
 * session: call it after every run; only the new runs (and a first pass) are added.
 */
export function recordResult(levelId: LevelId, session: LevelSession): void {
  const all = getProgress();
  const prev: LevelProgress = all[levelId] ?? {
    passed: false,
    bestRunsToTarget: null,
    hintsOpenedThen: null,
    bestTime: null,
    attempts: 0,
    runs: 0,
  };
  const seen = folded.get(session);
  const runs = session.runs.value;
  const next: LevelProgress = {
    ...prev,
    attempts: prev.attempts + (seen ? 0 : 1),
    runs: prev.runs + Math.max(0, runs.length - (seen?.runs ?? 0)),
  };
  for (const r of runs) {
    if (!r.outcome.finished) continue;
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

  const rtt = scoreOf(session);
  const passedNow = rtt !== null;
  if (passedNow && !seen?.passed) {
    next.passed = true;
    const hints = session.hintsAtPass?.value ?? 0;
    const better =
      next.bestRunsToTarget === null ||
      rtt < next.bestRunsToTarget ||
      (rtt === next.bestRunsToTarget && hints < (next.hintsOpenedThen ?? Infinity));
    if (better) {
      next.bestRunsToTarget = rtt;
      next.hintsOpenedThen = hints;
    }
    if (session.level.assist) {
      const first = runs.find((r) => r.index === rtt);
      if (first) {
        const rt = next.runsToTarget ?? { assisted: [], unassisted: [] };
        next.runsToTarget = first.assistOn
          ? { ...rt, assisted: [...rt.assisted, first.index] }
          : { ...rt, unassisted: [...rt.unassisted, first.index] };
      }
    }
  }
  folded.set(session, { runs: runs.length, passed: passedNow || !!seen?.passed });
  save(PROGRESS_KEY, PROGRESS_VERSION, { ...all, [levelId]: next });
}

/** Has the player done enough on `p`'s level to move on (passed, or `UNLOCK_AFTER_RUNS` runs)? */
export function canMoveOn(p: LevelProgress | undefined): boolean {
  return !!p && (p.passed || p.runs >= UNLOCK_AFTER_RUNS);
}

export function isUnlocked(levelId: LevelId): boolean {
  const idx = LEVELS.findIndex((l) => l.id === levelId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const prevId = LEVELS[idx - 1]?.id;
  const prev = prevId ? getProgress()[prevId] : undefined;
  // The Puzzle opens after B1L regardless of the result: any run there will do.
  if (levelId === 'B4L' && prevId === 'B1L') return !!prev && (prev.passed || prev.runs > 0);
  return canMoveOn(prev);
}
