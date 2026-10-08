/**
 * App-level game state: one sim client for the app, one live `LevelSession` per level (kept for
 * the browser session so the workbench and the debrief share runs), the setup draft per level,
 * hint-tier opens attributed to the run they followed (for the debrief convergence table), and
 * persisted progress as a signal.
 *
 * A session's result is recorded to progress once, when it first reaches `passed` or
 * `exhausted`. Retrying a level starts a fresh session; the old session's runs are kept (as
 * lightweight records) for the assist, which ranks every run so far on the track.
 *
 * Demo profile (`?demo=1`, `demo.ts`): every level is unlocked and the re-simulated recorded
 * attempt joins the assist pool.
 */
import { effect, signal, type Signal } from '@preact/signals';
import type { Setup } from '@/engine/types';
import { getProgress, isUnlocked, recordResult } from '@/game/progress';
import { startLevel } from '@/game/session';
import type { LevelProgress, LevelSession } from '@/game/types';
import { LEVELS, getLevel } from '@/levels/index';
import type { LevelConfig, LevelId } from '@/levels/types';
import { effectiveSetup } from '@/worker/build-input';
import { createSimClient } from '@/worker/client';
import type { SimClient } from '@/worker/types';
import type { AssistRun } from '@/assist/rank';
import { demoHistory, demoProfile, loadDemoHistory } from './demo';
import { log } from './log';

let client: SimClient | null = null;

/** The app's sim client (lazily spawns the worker). */
export function simClient(): SimClient {
  client ??= createSimClient();
  return client;
}

/** Persisted progress, refreshed after every record. */
export const progress: Signal<Record<LevelId, LevelProgress>> = signal(getProgress());

export function refreshProgress(): void {
  progress.value = getProgress();
}

/** Unlock state, reactive through `progress`. The demo profile unlocks everything. */
export function unlocked(id: LevelId): boolean {
  void progress.value;
  return demoProfile.value || isUnlocked(id);
}

/** Starts re-simulating the demo profile's recorded attempt (no-op without `?demo=1`). */
export function startDemoProfile(): void {
  if (demoProfile.value) void loadDemoHistory(simClient());
}

/** Runs from earlier sessions of a level in this browser session, oldest first. */
const pastRuns = signal<Partial<Record<LevelId, AssistRun[]>>>({});

/**
 * The runs the assist ranks besides the live session's: the demo profile's recorded attempt (on
 * its level) and earlier sessions of this level. Each entry is a real, simulated run.
 */
export function assistHistory(id: LevelId): { runs: AssistRun[]; recorded: number; past: number } {
  const demo = demoHistory.value;
  const recorded = demo && demo.levelId === id ? demo.runs : [];
  const past = pastRuns.value[id] ?? [];
  return { runs: [...recorded, ...past], recorded: recorded.length, past: past.length };
}

export interface LevelState {
  session: LevelSession;
  /** The setup the player is editing (full setup; locked levers are applied on top). */
  draft: Signal<Setup>;
  /** Hint tiers opened, keyed by the run index they followed. */
  hintOpens: Signal<Record<number, number>>;
  /** Shown once per session, before the first run. */
  briefSeen: Signal<boolean>;
  dispose(): void;
}

const states = new Map<LevelId, LevelState>();

function create(level: LevelConfig): LevelState {
  const session = startLevel(level, simClient());
  const draft = signal<Setup>(effectiveSetup(level, {}));
  const hintOpens = signal<Record<number, number>>({});
  const briefSeen = signal(false);
  let recorded = false;
  const stop = effect(() => {
    const st = session.status.value;
    if (recorded || (st !== 'passed' && st !== 'exhausted')) return;
    recorded = true;
    try {
      recordResult(level.id, session);
    } catch (err) {
      log.error('recording progress failed', err);
    }
    refreshProgress();
  });
  return { session, draft, hintOpens, briefSeen, dispose: stop };
}

/** The live state for a level, created on first use. */
export function levelState(id: LevelId): LevelState | null {
  const level = getLevel(id);
  if (!level) return null;
  let st = states.get(level.id);
  if (!st) {
    st = create(level);
    states.set(level.id, st);
  }
  return st;
}

/** The live state if one exists (the debrief does not start a session). */
export function existingLevelState(id: LevelId): LevelState | null {
  return states.get(id) ?? null;
}

/** Retry: drop the current session and start a fresh one (keeps the setup draft). */
export function retryLevel(id: LevelId): LevelState | null {
  const old = states.get(id);
  old?.dispose();
  states.delete(id);
  if (old && old.session.runs.value.length > 0) {
    const lite: AssistRun[] = old.session.runs.value.map(({ summary, outcome, hints }) => ({
      summary,
      outcome,
      hints,
    }));
    pastRuns.value = { ...pastRuns.value, [id]: [...(pastRuns.value[id] ?? []), ...lite] };
  }
  const st = levelState(id);
  if (st && old) {
    st.draft.value = old.draft.value;
    st.briefSeen.value = true;
  }
  return st;
}

/** Opens the next hint tier on a level, attributing it to the latest run. */
export function openHint(st: LevelState): boolean {
  const runs = st.session.runs.value;
  const match = st.session.openHintTier();
  if (!match) return false;
  const idx = runs[runs.length - 1]?.index ?? 0;
  st.hintOpens.value = { ...st.hintOpens.value, [idx]: (st.hintOpens.value[idx] ?? 0) + 1 };
  return true;
}

/** The level after `id` in unlock order, if any. */
export function nextLevel(id: LevelId): LevelConfig | null {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i >= 0 ? (LEVELS[i + 1] ?? null) : null;
}

/** Test hook: forget every session. */
export function resetGameStore(): void {
  for (const st of states.values()) st.dispose();
  states.clear();
  pastRuns.value = {};
  refreshProgress();
}
