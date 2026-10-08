import { signal, computed } from '@preact/signals-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Outcome } from '@/engine/types';
import { getProgress, isUnlocked, PROGRESS_VERSION, recordResult, scoreOf } from '@/game/progress';
import type { LevelSession, LevelStatus, RunRecord } from '@/game/types';
import { STUB_A2 } from '@/levels/index';
import type { GridResult } from '@/worker/types';
import { MemoryStorage } from './memory-storage';

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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

/** A minimal session double with fixed signals (no worker). */
function fakeSession(
  times: number[],
  status: LevelStatus,
  runsLeft: number,
  assist = false,
  assistLevel = assist,
) {
  const runs = times.map(
    (t, i) =>
      ({
        index: i + 1,
        outcome: { totalTime: t, segmentTimes: [t], topSpeed: 0, finished: true } satisfies Outcome,
        assistOn: assist,
      }) as RunRecord,
  );
  return {
    level: { ...STUB_A2, assist: assistLevel },
    grid: signal(GRID),
    runs: signal(runs),
    runsLeft: computed(() => runsLeft),
    status: computed(() => status),
  } as unknown as LevelSession;
}

describe('progress', () => {
  it('starts empty and persists a recorded result at signal.v1.progress', () => {
    expect(getProgress()).toEqual({});
    recordResult('A2', fakeSession([21, 20.1], 'passed', 4));
    const p = getProgress().A2;
    expect(p).toMatchObject({ passed: true, bestScore: 4, bestTime: 20.1, attempts: 1 });
    expect(p.segmentBests).toEqual([20.1]);
    expect(store.getItem('signal.v1.progress')).toContain('"v":1');
  });

  it('keeps the best score and best time across attempts', () => {
    recordResult('A2', fakeSession([20.1], 'passed', 5));
    recordResult('A2', fakeSession([20.0, 21], 'passed', 2));
    const p = getProgress().A2;
    expect(p).toMatchObject({ passed: true, bestScore: 5, bestTime: 20.0, attempts: 2 });
  });

  it('exhausted scores 0 (still completes the level); unfinished leaves the score null', () => {
    recordResult('A2', fakeSession([25], 'ready', 3));
    expect(getProgress().A2.bestScore).toBeNull();
    recordResult('A2', fakeSession([25, 24], 'exhausted', 0));
    expect(getProgress().A2).toMatchObject({ passed: false, bestScore: 0, attempts: 2 });
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
          A3: { passed: true, bestScore: 2, bestTime: 20, attempts: 1 },
        },
      }),
    );
    expect(Object.keys(getProgress())).toEqual(['A3']);
    // And a new result can still be written over it.
    recordResult('A2', fakeSession([20], 'passed', 5));
    expect(getProgress().A2.bestScore).toBe(5);
  });

  it('scoreOf: runsLeft at the moment of passing; 0 if not passed', () => {
    expect(scoreOf(fakeSession([20], 'passed', 3))).toBe(3);
    expect(scoreOf(fakeSession([25], 'exhausted', 0))).toBe(0);
    expect(scoreOf(fakeSession([25], 'ready', 4))).toBe(0);
  });

  it('isUnlocked: the first level is open; unknown ids are locked', () => {
    expect(isUnlocked('A2')).toBe(true);
    expect(isUnlocked('B4L')).toBe(false);
  });

  it('assist levels record runs to target by assist state', () => {
    recordResult('A2', fakeSession([21, 20.1], 'passed', 4, true));
    recordResult('A2', fakeSession([20.1], 'passed', 5, false, true));
    expect(getProgress().A2.runsToTarget).toEqual({ assisted: [2], unassisted: [1] });
  });
});
