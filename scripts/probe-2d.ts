/**
 * Dev-only: a 2D table of total time over two levers, others fixed.
 *   CAR='{…}' BASE='{"tire_pressure":1.7}' npx tsx scripts/probe-2d.ts B4L throttle_ramp weight_dist
 */
import { simulate } from '../src/engine/index';
import type { CarParams, LeverId, Setup } from '../src/engine/types';
import { getLevel } from '../src/levels/index';
import type { LevelConfig } from '../src/levels/types';
import { buildBaseSimInput } from '../src/worker/build-input';

const over = JSON.parse(process.env.CAR ?? '{}') as Partial<CarParams>;
const [id = 'B4L', a = 'throttle_ramp', b = 'weight_dist'] = process.argv.slice(2);
const base0 = getLevel(id)!;
const level: LevelConfig = { ...base0, car: { ...base0.car, ...over } };
const baseSetup = JSON.parse(process.env.BASE ?? '{}') as Partial<Setup>;
const MAXA = Number(process.env.MAXA ?? 99);

const grid = (lid: string): number[] => {
  const l = level.levers.find((x) => x.id === lid)!;
  const n = Math.round((l.max - l.min) / l.step);
  return Array.from({ length: n + 1 }, (_, i) => +(l.min + i * l.step).toFixed(3));
};
const ga = grid(a).slice(0, MAXA);
const gb = grid(b);
console.log(
  `${id} rows ${a}, cols ${b}, base ${JSON.stringify(baseSetup)} car ${JSON.stringify(over)}`,
);
console.log('      ' + gb.map((v) => String(v).padStart(7)).join(''));
for (const va of ga) {
  const row = gb.map((vb) => {
    const s = { ...baseSetup, [a as LeverId]: va, [b as LeverId]: vb };
    return simulate(buildBaseSimInput(level, s), 'fast').outcome.totalTime;
  });
  console.log(String(va).padEnd(6) + row.map((t) => t.toFixed(3).padStart(7)).join(''));
}
