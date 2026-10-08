/** Unlock order with a multi-level table (the Stage 5 stub has only A2, so it is mocked here). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LevelsModule from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { MemoryStorage } from './memory-storage';

vi.mock('@/levels/index', async (importOriginal) => {
  const real = await importOriginal<typeof LevelsModule>();
  const lv = (id: LevelConfig['id']): LevelConfig => ({ ...real.A2, id });
  return { ...real, LEVELS: [lv('A1'), lv('A2'), lv('B1L'), lv('B4L')] };
});

const { isUnlocked } = await import('@/game/progress');
const { save } = await import('@/persist/storage');

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

const entry = (passed: boolean, bestScore: number | null) => ({
  passed,
  bestScore,
  bestTime: null,
  attempts: 1,
});

describe('isUnlocked', () => {
  it('levels unlock in order', () => {
    expect(isUnlocked('A1')).toBe(true);
    expect(isUnlocked('A2')).toBe(false);
    save('progress', 1, { A1: entry(true, 3) });
    expect(isUnlocked('A2')).toBe(true);
    expect(isUnlocked('B1L')).toBe(false);
  });

  it('an unfinished attempt does not unlock the next level', () => {
    save('progress', 1, { A1: entry(false, null) });
    expect(isUnlocked('A2')).toBe(false);
  });

  it('failing (exhausted, score 0) still unlocks the next level; B4L after B1L regardless of score', () => {
    save('progress', 1, { A1: entry(false, 0), A2: entry(true, 2), B1L: entry(false, 0) });
    expect(isUnlocked('A2')).toBe(true);
    expect(isUnlocked('B1L')).toBe(true);
    expect(isUnlocked('B4L')).toBe(true);
  });
});
