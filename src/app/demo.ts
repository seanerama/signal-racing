/**
 * The guided demo profile (`?demo=1`). It loads a canned, labelled, unassisted Puzzle history so
 * the with/without-assist comparison exists on a fresh install.
 *
 * Honest by construction: `demo-history.json` stores only the setups and run seeds of an attempt
 * played by hand without the assist. On load every run is re-simulated through the normal sim
 * worker and a real `LevelSession` (so hints, the target and the pass are computed exactly as in
 * play); no time, outcome or ranking is stored. If the engine or the level changed since the
 * recording, the re-simulated numbers change with it.
 *
 * While the profile is active: every level is unlocked (the demo opens straight on the Puzzle),
 * the top bar shows a `DEMO PROFILE` chip, the debrief shows the recorded attempt's runs-to-target
 * labelled as such, and the assist pools the recorded runs with this session's (it ranks "the
 * runs so far" on this track).
 */
import { signal } from '@preact/signals';
import type { Setup } from '@/engine/types';
import { runPasses, startLevel } from '@/game/session';
import { getLevel } from '@/levels/index';
import type { LevelId } from '@/levels/types';
import { runSeed } from '@/worker/build-input';
import type { SimClient } from '@/worker/types';
import type { AssistRun } from '@/assist/rank';
import history from './demo-history.json';
import { demoProfile } from './demo-flag';
import { log } from './log';

export { demoProfile };

export interface HistoryRun extends AssistRun {
  index: number;
  setup: Setup;
  seed: number;
  assistOn: boolean;
}

export interface DemoHistory {
  levelId: LevelId;
  label: string;
  note: string;
  recordedOn: string;
  runs: HistoryRun[];
  /** First run (1-based) at or under the target, from the re-simulation; null if none. */
  passIndex: number | null;
  /** Every stored seed equals `runSeed(level, runIndex)` today. */
  seedsMatch: boolean;
}

interface Fixture {
  version: number;
  levelId: LevelId;
  assist: boolean;
  recordedOn: string;
  label: string;
  note: string;
  runs: Array<{ runIndex: number; seed: number; setup: Setup }>;
}

export const demoHistory = signal<DemoHistory | null>(null);
export const demoStatus = signal<'off' | 'loading' | 'ready' | 'failed'>('off');

let started: Promise<DemoHistory | null> | null = null;

/** Re-simulates the recorded attempt. Idempotent; resolves null on failure (logged). */
export function loadDemoHistory(client: SimClient): Promise<DemoHistory | null> {
  started ??= replay(client).then(
    (h) => {
      demoHistory.value = h;
      demoStatus.value = 'ready';
      return h;
    },
    (err: unknown) => {
      log.error('demo profile: re-simulating the recorded attempt failed', err);
      demoStatus.value = 'failed';
      return null;
    },
  );
  return started;
}

async function replay(client: SimClient): Promise<DemoHistory> {
  demoStatus.value = 'loading';
  const fx = history as Fixture;
  const level = getLevel(fx.levelId);
  if (!level) throw new Error(`demo history: unknown level ${fx.levelId}`);
  const seedsMatch = fx.runs.every((r) => r.seed === runSeed(level.id, r.runIndex));
  if (!seedsMatch) log.warn('demo history: stored seeds differ from runSeed(); runs use runSeed()');
  // A private session: same worker, grid, telemetry, summary and hints as real play.
  const session = startLevel(level, client);
  for (const r of [...fx.runs].sort((a, b) => a.runIndex - b.runIndex)) {
    await session.run(r.setup);
  }
  const grid = session.grid.value;
  const recs = session.runs.value;
  const first = grid ? recs.find((r) => runPasses(level, r, grid)) : undefined;
  const runs: HistoryRun[] = recs.map((r) => ({
    index: r.index,
    setup: r.setup,
    seed: r.seed,
    assistOn: false,
    summary: r.summary,
    outcome: r.outcome,
    hints: r.hints,
  }));
  log.info(
    `demo profile: re-simulated ${runs.length} recorded ${level.id} runs; ` +
      `target first met on run ${first?.index ?? 'none'}`,
  );
  return {
    levelId: level.id,
    label: fx.label,
    note: fx.note,
    recordedOn: fx.recordedOn,
    runs,
    passIndex: first?.index ?? null,
    seedsMatch,
  };
}

/** Tests. */
export function resetDemo(): void {
  started = null;
  demoHistory.value = null;
  demoStatus.value = 'off';
}
