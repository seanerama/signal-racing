/**
 * Dev-only: tune the tire temperature coefficients (row 15 VALUES: kHeat, kCool, slide
 * multiplier; the equation is unchanged). With `tempAffectsGrip` off on every level the
 * temperatures do not feed back into the motion, so the row-15 ODE can be replayed offline over
 * recorded runs for candidate values. Runs a coarse grid (k points per lever, plus the
 * optimum) for every level on run indices 1 and 2.
 *
 *   npx tsx scripts/tune-temps.ts [pointsPerLever]
 */
import { DEFAULT_CAR, simulate } from '../src/engine/index';
import { DT } from '../src/engine/constants';
import { evenIndices, gridSearch, leverGrid } from '../src/game/grid-search';
import { LEVELS } from '../src/levels/index';
import { buildSimInput } from '../src/worker/build-input';
import type { Setup } from '../src/engine/types';

const k = Number(process.argv[2] ?? 5);

interface Rec {
  level: string;
  optimum: boolean;
  v: Float32Array;
  heat: Float32Array[]; // front, rear
  slide: Uint8Array[]; // front, rear
  track: number;
}
const recs: Rec[] = [];
for (const level of LEVELS) {
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
  const opt = gridSearch(level).optimum.setup;
  setups.push(opt);
  setups.forEach((setup, si) => {
    for (const runIndex of [1, 2]) {
      const input = buildSimInput(level, setup, runIndex);
      const c = simulate(input, 'full').columns!;
      const car = input.car;
      const heat = [new Float32Array(c.n), new Float32Array(c.n)];
      const slide = [new Uint8Array(c.n), new Uint8Array(c.n)];
      for (let i = 0; i < c.n; i++) {
        heat[0]![i] = level.flags.tractionLimit
          ? c.ch.grip_used_front![i]!
          : c.ch.grip_used_front![i]! * (c.ch.mu_front![i]! / car.muPeak);
        heat[1]![i] = level.flags.tractionLimit
          ? c.ch.grip_used_rear![i]!
          : c.ch.grip_used_rear![i]! * (c.ch.mu_rear![i]! / car.muPeak);
        slide[0]![i] = c.ch.front_slip_ratio![i]! > car.sPeak + 1e-6 ? 1 : 0;
        slide[1]![i] = c.ch.rear_slip_ratio![i]! > car.sPeak + 1e-6 ? 1 : 0;
      }
      recs.push({
        level: level.id,
        optimum: si === setups.length - 1,
        v: c.ch.speed!,
        heat,
        slide,
        track: input.conditions.trackTemp,
      });
    }
  });
  console.log(`${level.id}: ${setups.length} setups recorded`);
}
void DEFAULT_CAR;

function replay(r: Rec, kHeat: number, kCool: number, mult: number): [number, number] {
  let peak = -Infinity;
  let end = 0;
  for (const axle of [0, 1]) {
    let t = r.track;
    const h = r.heat[axle]!;
    const sl = r.slide[axle]!;
    for (let i = 0; i < r.v.length; i++) {
      if (t > peak) peak = t;
      const u = h[i]!;
      t += DT * (kHeat * u * u * r.v[i]! * (sl[i] ? mult : 1) - kCool * (t - r.track));
    }
    if (t > peak) peak = t;
    end = Math.max(end, t);
  }
  return [peak, end];
}

const candidates: Array<[number, number, number]> = [];
for (const kHeat of [0.9, 0.2, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03])
  for (const kCool of [0.02, 0.04, 0.06, 0.08, 0.1])
    for (const mult of [4, 3, 2, 1.5]) candidates.push([kHeat, kCool, mult]);

for (const [kHeat, kCool, mult] of candidates) {
  const perLevel = new Map<string, { worst: number; opt: number }>();
  for (const r of recs) {
    const [peak] = replay(r, kHeat, kCool, mult);
    const e = perLevel.get(r.level) ?? { worst: -Infinity, opt: -Infinity };
    e.worst = Math.max(e.worst, peak);
    if (r.optimum) e.opt = Math.max(e.opt, peak);
    perLevel.set(r.level, e);
  }
  const worst = Math.max(...[...perLevel.values()].map((e) => e.worst));
  if (worst > 145 && kHeat < 0.9) continue;
  console.log(
    `kHeat ${kHeat} kCool ${kCool} mult ${mult}: worst ${worst.toFixed(0)} | ` +
      [...perLevel].map(([id, e]) => `${id} ${e.worst.toFixed(0)}/${e.opt.toFixed(0)}`).join('  '),
  );
}
