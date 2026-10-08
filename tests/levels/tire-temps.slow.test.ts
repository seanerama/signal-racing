/**
 * Stage 9: tire temperatures stay in a plausible band (≤ 140 °C peak) on every level, over a
 * coarse sweep of the lever grid (5 points per lever, endpoints included, plus the grid-search
 * optimum) on two run seeds. `scripts/temps.ts all 99` runs the exhaustive grid (measured peaks
 * are in the Stage 9 report).
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '@/engine/index';
import type { Setup } from '@/engine/types';
import { evenIndices, gridSearch, leverGrid } from '@/game/grid-search';
import { LEVELS } from '@/levels/index';
import { buildSimInput } from '@/worker/build-input';

const TEMPS = ['tire_temp_fl', 'tire_temp_fr', 'tire_temp_rl', 'tire_temp_rr'];

describe('tire temperature band', () => {
  for (const level of LEVELS) {
    it(`${level.id}: peak tire temperature ≤ 140 °C across the lever grid`, () => {
      let setups: Partial<Setup>[] = [{}];
      for (const l of level.levers) {
        const g = leverGrid(l);
        const pts = evenIndices(g.length, 5).map((i) => g[i]!);
        setups = setups.flatMap((s) => pts.map((v) => ({ ...s, [l.id]: v })));
      }
      setups.push(gridSearch(level).optimum.setup);
      let peak = -Infinity;
      for (const setup of setups) {
        for (const runIndex of [1, 2]) {
          const c = simulate(buildSimInput(level, setup, runIndex), 'full').columns!;
          for (const id of TEMPS) {
            const col = c.ch[id]!;
            for (let i = 0; i < c.n; i++) if (col[i]! > peak) peak = col[i]!;
          }
        }
      }
      expect(peak).toBeLessThanOrEqual(140);
      expect(peak).toBeGreaterThan(level.conditions.base.trackTemp);
    });
  }
});
