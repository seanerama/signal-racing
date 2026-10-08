/**
 * Dev-only scan of tire temperatures and rear-slide episodes over each level's lever grid
 * (coarse: k points per lever, plus the grid-search optimum), on run indices 1 and 2. Stage 9
 * used it to find and verify the latched-slide fix and the tire temperature band.
 *
 *   npx tsx scripts/temps.ts [levelId|all] [pointsPerLever]
 */
import { simulate } from '../src/engine/index';
import { evenIndices, gridSearch, leverGrid } from '../src/game/grid-search';
import { LEVELS } from '../src/levels/index';
import { buildSimInput } from '../src/worker/build-input';
import type { Setup } from '../src/engine/types';

const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : undefined;
const k = Number(process.argv[3] ?? 6);
const TEMPS = ['tire_temp_fl', 'tire_temp_fr', 'tire_temp_rl', 'tire_temp_rr'];

for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  const grids = level.levers.map((l) => {
    const g = leverGrid(l);
    return evenIndices(g.length, k).map((i) => g[i]!);
  });
  let setups: Partial<Setup>[] = [{}];
  level.levers.forEach((l, j) => {
    const next: Partial<Setup>[] = [];
    for (const s of setups) for (const v of grids[j]!) next.push({ ...s, [l.id]: v });
    setups = next;
  });
  setups.push(gridSearch(level).optimum.setup);
  let peak = -Infinity;
  let peakSetup: Partial<Setup> = {};
  let worstAfterRelease = 0;
  let worstSetup: Partial<Setup> = {};
  let worstTailSlide = 0;
  for (const setup of setups) {
    for (const runIndex of [1, 2]) {
      const c = simulate(buildSimInput(level, setup, runIndex), 'full').columns!;
      for (const id of TEMPS) {
        const col = c.ch[id]!;
        for (let i = 0; i < c.n; i++) {
          if (col[i]! > peak) {
            peak = col[i]!;
            peakSetup = setup;
          }
        }
      }
      // A rear slide that outlives a brake release: slip above sPeak after brake → 0.
      const brake = c.ch.brake!;
      const slip = c.ch.rear_slip_ratio!;
      for (let i = 1; i < c.n; i++) {
        if (brake[i - 1]! > 0 && brake[i] === 0) {
          let j = i;
          while (j < c.n && slip[j]! > 0.1 + 1e-4) j++;
          const dur = (j - i) * c.dt;
          if (dur > worstAfterRelease) {
            worstAfterRelease = dur;
            worstSetup = setup;
          }
        }
      }
      // Slide still on at the last sample.
      let j = c.n - 1;
      while (j >= 0 && slip[j]! > 0.1 + 1e-4) j--;
      worstTailSlide = Math.max(worstTailSlide, (c.n - 1 - j) * c.dt);
    }
  }
  console.log(
    `${level.id.padEnd(4)} setups ${String(setups.length).padStart(5)}  peak tire ${peak.toFixed(1)} °C ${JSON.stringify(peakSetup)}  ` +
      `slide after brake release ≤ ${worstAfterRelease.toFixed(2)} s ${JSON.stringify(worstSetup)}  slide at finish ${worstTailSlide.toFixed(2)} s`,
  );
}
