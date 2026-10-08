/**
 * Stage 11 (Fable finding 5): hints never go silent while a run is off target. On a deterministic
 * sample of every level's lever grid (every point up to 200, else ~120 evenly strided), any run
 * that misses the target fires at least one rule. ~40 s, so it runs under `npm run test:slow`.
 */
import { describe, expect, it } from 'vitest';
import type { Setup } from '@/engine/types';
import { LEVELS } from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { gridFor, passes, playRun } from './hint-bot';

const T = { timeout: 300_000 };
const steps = (min: number, max: number, step: number): number[] =>
  Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => +(min + i * step).toFixed(3),
  );

describe('hints never go silent off target (slow)', () => {
  /** A deterministic sample of the level's grid: every point up to 200, else a stride. */
  function sample(level: LevelConfig): Array<Partial<Setup>> {
    let pts: Array<Partial<Setup>> = [{}];
    for (const l of level.levers)
      pts = pts.flatMap((p) => steps(l.min, l.max, l.step).map((v) => ({ ...p, [l.id]: v })));
    if (pts.length <= 200) return pts;
    const stride = Math.ceil(pts.length / 120);
    return pts.filter((_, i) => i % stride === 0);
  }

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s', T, (_id, level) => {
    const g = gridFor(level);
    const silent: string[] = [];
    for (const s of sample(level)) {
      const r = playRun(level, g, s, 1);
      if (passes(level, r.outcome, g)) continue;
      if (r.hints.length === 0) silent.push(JSON.stringify(s));
    }
    expect(silent).toEqual([]);
  });
});
