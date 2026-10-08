/**
 * Stage 5 Pipeline Test (Node): createSimClient() → gridSearch('A2') → run(optimum.setup) →
 * startLevel session flow → the run passes, status becomes 'passed', and recordResult persists a
 * score. The worker is the in-process adapter (real message loop + handlers, structured-clone
 * transfer); the browser half of this test is `tests/e2e/dev-worker.spec.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGridCache } from '@/game/grid-cache';
import { getProgress, isUnlocked, recordResult, scoreOf } from '@/game/progress';
import { startLevel } from '@/game/session';
import { A2 as STUB_A2 } from '@/levels/index';
import { createSimClient } from '@/worker/client';
import { createInProcessWorker } from '../worker/adapter';
import { MemoryStorage } from './memory-storage';

vi.setConfig({ testTimeout: 60_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  clearGridCache();
});

describe('pipeline (Node, handler adapter)', () => {
  it('grid A2 → run optimum → session passes → progress persisted', async () => {
    const store = new MemoryStorage();
    vi.stubGlobal('localStorage', store);
    const client = createSimClient(createInProcessWorker());

    const grid = await client.gridSearch({ levelId: 'A2' });
    const direct = await client.run({ levelId: 'A2', setup: grid.optimum.setup, runIndex: 1 });
    expect(direct.outcome.totalTime).toBeLessThanOrEqual(grid.target);

    const session = startLevel(STUB_A2, client);
    const rec = await session.run(grid.optimum.setup);
    expect(rec.outcome.totalTime).toBeLessThanOrEqual(session.grid.value!.target);
    expect(session.grid.value!.optimum).toEqual(grid.optimum);
    expect(session.status.value).toBe('passed');
    // Stage 10: the score is runs to target (here the first run), with no hints opened.
    expect(scoreOf(session)).toBe(1);
    expect(session.hintsAtPass.value).toBe(0);

    recordResult('A2', session);
    const p = getProgress().A2;
    expect(p).toMatchObject({
      passed: true,
      bestRunsToTarget: 1,
      hintsOpenedThen: 0,
      attempts: 1,
      runs: 1,
    });
    expect(p.bestTime).toBe(rec.outcome.totalTime);
    expect(JSON.parse(store.getItem('signal.v1.progress')!)).toMatchObject({
      v: 2,
      data: { A2: { passed: true } },
    });
    expect(isUnlocked('A3')).toBe(true);
    client.dispose();
  });
});
