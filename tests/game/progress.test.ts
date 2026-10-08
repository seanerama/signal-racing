import { signal, computed } from '@preact/signals-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Outcome } from '@/engine/types';
import {
  getProgress,
  isUnlocked,
  migrateV1Entry,
  PROGRESS_VERSION,
  recordResult,
  scoreOf,
  UNLOCK_AFTER_RUNS,
} from '@/game/progress';
import type { LevelSession, RunRecord } from '@/game/types';
import { STUB_A2 } from './stub-level';
import type { GridResult } from '@/worker/types';
import { MemoryStorage } from './memory-storage';

let store: MemoryStorage;
const warned: string[] = [];
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
  warned.length = 0;
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GRID = {
  levelId: 'A2',
  optimum: { outcome: { totalTime: 20, segmentTimes: [20], topSpeed: 0, finished: true } },
  target: 20.2,
  segmentFloors: [20],
} as GridResult;

/**
 * A minimal session double (no worker): `times` are the run times; a time ≤ 20.2 meets the
 * target. `hintsAtPass` is what the live session reports for its first pass.
 */
function fakeSession(
  times: number[],
  opts: { hintsAtPass?: number; assist?: boolean; assistLevel?: boolean } = {},
) {
  const assist = opts.assist ?? false;
  const runs = signal(
    times.map(
      (t, i) =>
        ({
          index: i + 1,
          outcome: {
            totalTime: t,
            segmentTimes: [t],
            topSpeed: 0,
            finished: true,
          } satisfies Outcome,
          assistOn: assist,
        }) as RunRecord,
    ),
  );
  const first = computed(() => runs.value.find((r) => r.outcome.totalTime <= GRID.target));
  return {
    level: { ...STUB_A2, assist: opts.assistLevel ?? assist },
    grid: signal(GRID),
    runs,
    runsToTarget: computed(() => first.value?.index ?? null),
    hintsAtPass: computed(() => (first.value ? (opts.hintsAtPass ?? 0) : null)),
    status: computed(() => (first.value ? 'passed' : 'ready')),
  } as unknown as LevelSession & { runs: ReturnType<typeof signal<RunRecord[]>> };
}

describe('progress (Stage 10: runs to target, version 2)', () => {
  it('starts empty and persists a recorded result at signal.v1.progress (v2)', () => {
    expect(getProgress()).toEqual({});
    recordResult('A2', fakeSession([21, 20.1], { hintsAtPass: 1 }));
    const p = getProgress().A2;
    expect(p).toMatchObject({
      passed: true,
      bestRunsToTarget: 2,
      hintsOpenedThen: 1,
      bestTime: 20.1,
      attempts: 1,
      runs: 2,
    });
    expect(p.segmentBests).toEqual([20.1]);
    expect(store.getItem('signal.v1.progress')).toContain(`"v":${PROGRESS_VERSION}`);
    expect(PROGRESS_VERSION).toBe(2);
  });

  it('is incremental per session: calling after every run adds only the new runs', () => {
    const s = fakeSession([22]);
    recordResult('A2', s);
    expect(getProgress().A2).toMatchObject({ runs: 1, attempts: 1, passed: false });
    s.runs.value = [
      ...s.runs.value,
      {
        index: 2,
        outcome: { totalTime: 20.0, segmentTimes: [20.0], topSpeed: 0, finished: true },
        assistOn: false,
      } as RunRecord,
    ];
    recordResult('A2', s);
    recordResult('A2', s); // idempotent
    expect(getProgress().A2).toMatchObject({
      runs: 2,
      attempts: 1,
      passed: true,
      bestRunsToTarget: 2,
    });
  });

  it('keeps the fewest runs to target (ties: fewer hints) and the best time across attempts', () => {
    recordResult('A2', fakeSession([21, 20.1], { hintsAtPass: 2 }));
    recordResult('A2', fakeSession([20.0], { hintsAtPass: 0 }));
    recordResult('A2', fakeSession([21, 21, 20.15], { hintsAtPass: 0 }));
    const p = getProgress().A2;
    expect(p).toMatchObject({
      passed: true,
      bestRunsToTarget: 1,
      hintsOpenedThen: 0,
      bestTime: 20.0,
      attempts: 3,
      runs: 6,
    });
    // A tie on runs keeps the attempt with fewer hints.
    store.clear();
    recordResult('A2', fakeSession([21, 20.1], { hintsAtPass: 3 }));
    recordResult('A2', fakeSession([21, 20.1], { hintsAtPass: 1 }));
    expect(getProgress().A2).toMatchObject({ bestRunsToTarget: 2, hintsOpenedThen: 1 });
  });

  it('a session that has not met the target leaves the score null', () => {
    recordResult('A2', fakeSession([25, 24]));
    expect(getProgress().A2).toMatchObject({
      passed: false,
      bestRunsToTarget: null,
      hintsOpenedThen: null,
      runs: 2,
    });
  });

  it('survives corrupt storage (falls back to empty)', () => {
    store.setItem('signal.v1.progress', '{not json');
    expect(getProgress()).toEqual({});
    store.setItem('signal.v1.progress', JSON.stringify({ v: PROGRESS_VERSION, data: [1, 2] }));
    expect(getProgress()).toEqual({});
    store.setItem(
      'signal.v1.progress',
      JSON.stringify({
        v: PROGRESS_VERSION,
        data: {
          A2: { passed: 'yes' },
          A3: {
            passed: true,
            bestRunsToTarget: 2,
            hintsOpenedThen: 0,
            bestTime: 20,
            attempts: 1,
            runs: 2,
          },
        },
      }),
    );
    expect(Object.keys(getProgress())).toEqual(['A3']);
    // And a new result can still be written over it.
    recordResult('A2', fakeSession([20]));
    expect(getProgress().A2.bestRunsToTarget).toBe(1);
  });

  it('migrates version-1 progress: scores discarded with a warning, passes and bests kept', () => {
    store.setItem(
      'signal.v1.progress',
      JSON.stringify({
        v: 1,
        data: {
          A1: { passed: true, bestScore: 3, bestTime: 18.5, attempts: 2, segmentBests: [18.5] },
          A2: { passed: false, bestScore: 0, bestTime: 19.4, attempts: 1 },
          A3: { passed: false, bestScore: null, bestTime: null, attempts: 1 },
          A4: { passed: 'broken' },
        },
      }),
    );
    const p = getProgress();
    expect(p.A1).toMatchObject({
      passed: true,
      bestRunsToTarget: null,
      hintsOpenedThen: null,
      bestTime: 18.5,
      attempts: 2,
      segmentBests: [18.5],
    });
    // Completed (exhausted) in v1 → the next level stays unlocked.
    expect(p.A2.runs).toBeGreaterThanOrEqual(UNLOCK_AFTER_RUNS);
    expect(p.A3.runs).toBe(0);
    expect(p.A4).toBeUndefined();
    expect(warned.some((w) => w.includes('discarded'))).toBe(true);
    // Saved as v2 straight away.
    expect(store.getItem('signal.v1.progress')).toContain('"v":2');
    expect(migrateV1Entry({ passed: true })).toBeNull();
  });

  it('scoreOf: runs to target; null if not met', () => {
    expect(scoreOf(fakeSession([21, 20]))).toBe(2);
    expect(scoreOf(fakeSession([25]))).toBeNull();
  });

  it('isUnlocked: the first level is open; others need the previous level', () => {
    expect(isUnlocked('A1')).toBe(true);
    expect(isUnlocked('A2')).toBe(false);
    expect(isUnlocked('B4L')).toBe(false);
  });

  it('assist levels record runs to target by assist state', () => {
    recordResult('A2', fakeSession([21, 20.1], { assist: true }));
    recordResult('A2', fakeSession([20.1], { assistLevel: true }));
    expect(getProgress().A2.runsToTarget).toEqual({ assisted: [2], unassisted: [1] });
  });
});
