/**
 * Unlock order with a multi-level table (the Stage 5 stub has only A2, so it is mocked here).
 * Stage 10: the next level unlocks on a pass, or after five runs without passing; the Puzzle
 * (B4L) unlocks after B1L regardless of the result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LevelsModule from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { MemoryStorage } from './memory-storage';

vi.mock('@/levels/index', async (importOriginal) => {
  const real = await importOriginal<typeof LevelsModule>();
  const lv = (id: LevelConfig['id']): LevelConfig => ({ ...real.A2, id });
  return { ...real, LEVELS: [lv('A1'), lv('A2'), lv('B1L'), lv('B4L')] };
});

const { isUnlocked, PROGRESS_VERSION, UNLOCK_AFTER_RUNS } = await import('@/game/progress');
const { save } = await import('@/persist/storage');

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

const entry = (passed: boolean, runs: number) => ({
  passed,
  bestRunsToTarget: passed ? runs : null,
  hintsOpenedThen: passed ? 0 : null,
  bestTime: null,
  attempts: 1,
  runs,
});

describe('isUnlocked', () => {
  it('levels unlock in order, on a pass', () => {
    expect(isUnlocked('A1')).toBe(true);
    expect(isUnlocked('A2')).toBe(false);
    save('progress', PROGRESS_VERSION, { A1: entry(true, 3) });
    expect(isUnlocked('A2')).toBe(true);
    expect(isUnlocked('B1L')).toBe(false);
  });

  it('fewer than five runs without a pass keeps the next level locked', () => {
    save('progress', PROGRESS_VERSION, { A1: entry(false, UNLOCK_AFTER_RUNS - 1) });
    expect(isUnlocked('A2')).toBe(false);
  });

  it('five runs without passing unlocks the next level ("you can move on")', () => {
    expect(UNLOCK_AFTER_RUNS).toBe(5);
    save('progress', PROGRESS_VERSION, { A1: entry(false, 5), A2: entry(false, 7) });
    expect(isUnlocked('A2')).toBe(true);
    expect(isUnlocked('B1L')).toBe(true);
  });

  it('the Puzzle unlocks after any run on B1L, regardless of the result', () => {
    save('progress', PROGRESS_VERSION, { A1: entry(true, 1), A2: entry(true, 2) });
    expect(isUnlocked('B4L')).toBe(false);
    save('progress', PROGRESS_VERSION, {
      A1: entry(true, 1),
      A2: entry(true, 2),
      B1L: entry(false, 1),
    });
    expect(isUnlocked('B4L')).toBe(true);
  });
});
