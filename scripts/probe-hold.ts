/** Dev-only: corner hold speed vs cornerLimitSpeed (guarantee 8) per case and weight. */
import { cornerLimitSpeed, DEFAULT_CAR, simulate } from '../src/engine/index';
import type { CarParams } from '../src/engine/types';
import { BASE_SETUP, CONDITIONS, FLAGS_A2, TRACK_A4, TRACK_B1 } from '../tests/engine/fixtures';

const car: CarParams = { ...DEFAULT_CAR, ...(JSON.parse(process.env.CAR ?? '{}') as object) };
for (const wd of [0.38, 0.42, 0.45, 0.48, 0.52])
  for (const [name, track, wing] of [
    ['A4', TRACK_A4, 0],
    ['A4', TRACK_A4, 4],
    ['A4', TRACK_A4, 8],
    ['B1', TRACK_B1, 2],
    ['B1', TRACK_B1, 6],
  ] as const) {
    const setup = { ...BASE_SETUP, wing, weight_dist: wd };
    const r = simulate(
      { car, setup, track, conditions: CONDITIONS, flags: FLAGS_A2, seed: 1 },
      'full',
    );
    const c = r.columns!;
    const vLim = cornerLimitSpeed(car, setup, CONDITIONS, FLAGS_A2, track.segments[1]!.radius!);
    const idx = [...c.seg.keys()].filter((i) => c.seg[i] === 1);
    const mid = idx.slice(Math.floor(idx.length / 4), Math.ceil((3 * idx.length) / 4));
    let dev = 0;
    let uf = 0;
    let ur = 0;
    for (const i of mid) {
      dev = Math.max(dev, Math.abs(c.ch.speed![i]! - vLim) / vLim);
      uf = Math.max(uf, c.ch.grip_used_front![i]!);
      ur = Math.max(ur, c.ch.grip_used_rear![i]!);
    }
    console.log(
      `wd ${wd} ${name} wing ${wing}: vLim ${vLim.toFixed(2)} dev ${(dev * 100).toFixed(2)}% usedF ${uf.toFixed(3)} usedR ${ur.toFixed(3)}`,
    );
  }
