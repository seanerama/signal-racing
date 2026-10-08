/**
 * Dev-only tuning helper: for each candidate set of DEFAULT_CAR overrides, prints a one-block
 * summary of the lesson guarantees (A1 monotone, A2 ramp/pressure optimum, A3 weight optimum and
 * front lock, A4 and B1-lite wing optimum). Used to choose DEFAULT_CAR values; never the equations.
 *
 *   npx --yes tsx scripts/tune.ts '[{"fPeak":6000},{"fPeak":6200}]'
 */
import { DEFAULT_CAR } from '../src/engine/car';
import { simulate } from '../src/engine/simulate';
import type { CarParams, ModelFlags, Setup, Track } from '../src/engine/types';
import {
  BASE_SETUP,
  CONDITIONS,
  FLAGS_A1,
  FLAGS_A2,
  PRESSURES,
  RAMPS,
  TRACK_A1,
  TRACK_A3,
  TRACK_A4,
  TRACK_B1,
  WEIGHT_DISTS,
  WINGS,
} from '../tests/engine/fixtures';

const candidates = JSON.parse(process.argv[2] ?? '[{}]') as Partial<CarParams>[];
/** Optional comma list of parts to run: A1,A2,A3,A4 (A4 covers B1 too). */
const parts = (process.argv[3] ?? 'A1,A2,A3,A4').split(',');
const on = (k: string): boolean => parts.includes(k);

function t(car: CarParams, track: Track, flags: ModelFlags, s: Partial<Setup>): number {
  return simulate(
    { car, setup: { ...BASE_SETUP, ...s }, track, conditions: CONDITIONS, flags, seed: 1 },
    'fast',
  ).outcome.totalTime;
}

function argmin<T>(xs: T[], f: (x: T) => number): { x: T; v: number } {
  let best = { x: xs[0] as T, v: Infinity };
  for (const x of xs) {
    const v = f(x);
    if (v < best.v) best = { x, v };
  }
  return best;
}

const pct = (a: number, b: number): string => `${(((b - a) / a) * 100).toFixed(2)}%`;

for (const o of candidates) {
  const car: CarParams = { ...DEFAULT_CAR, ...o };
  console.log(`\n=== ${JSON.stringify(o)}`);
  if (on('A1')) {
    const a1 = RAMPS.map((r) => t(car, TRACK_A1, FLAGS_A1, { throttle_ramp: r }));
    console.log(`A1 monotone: ${a1.every((x, i) => i === 0 || x >= (a1[i - 1] ?? 0))}`);
  }
  if (on('A2')) {
    for (const p of [1.65, 1.6, 1.7]) {
      const rows = RAMPS.map((r) =>
        t(car, TRACK_A2_TRACK(), FLAGS_A2, { throttle_ramp: r, tire_pressure: p }),
      );
      const b = argmin(RAMPS, (r) => rows[RAMPS.indexOf(r)] ?? Infinity);
      console.log(
        `A2 p=${p}: best ramp ${b.x} t=${b.v.toFixed(3)} | r0 ${rows[0]?.toFixed(3)} r3.0 ${rows[15]?.toFixed(3)} spread ${pct(b.v, Math.max(...rows))} | ${rows.map((x) => x.toFixed(2)).join(' ')}`,
      );
    }
    const bp = argmin(
      PRESSURES,
      (p) =>
        argmin(RAMPS, (r) => t(car, TRACK_A1, FLAGS_A2, { throttle_ramp: r, tire_pressure: p })).v,
    );
    console.log(`A2 best pressure ${bp.x}`);
  }
  if (on('A3')) {
    const a3 = WEIGHT_DISTS.map((d) =>
      argmin(RAMPS, (r) => t(car, TRACK_A3, FLAGS_A2, { throttle_ramp: r, weight_dist: d })),
    );
    const b3 = argmin(WEIGHT_DISTS, (d) => a3[WEIGHT_DISTS.indexOf(d)]?.v ?? Infinity);
    console.log(
      `A3 best wd ${b3.x} | ${WEIGHT_DISTS.map((d, i) => `${d}:${a3[i]?.v.toFixed(3)}(r${a3[i]?.x})`).join(' ')} spread ${pct(b3.v, Math.max(...a3.map((x) => x.v)))}`,
    );
    const r52 = simulate(
      {
        car,
        setup: { ...BASE_SETUP, weight_dist: 0.52, throttle_ramp: a3[7]?.x ?? 0 },
        track: TRACK_A3,
        conditions: CONDITIONS,
        flags: FLAGS_A2,
        seed: 1,
      },
      'full',
    );
    const fs = r52.columns?.ch.front_slip_ratio;
    console.log(`A3 wd 0.52 max front slip ${fs ? Math.max(...fs).toFixed(3) : '?'}`);
  }
  if (on('A4')) {
    for (const [name, track] of [
      ['A4', TRACK_A4],
      ['B1', TRACK_B1],
    ] as const) {
      const rows = WINGS.map((w) => {
        let best = Infinity;
        for (const r of [0, 0.2, 0.4, 0.6])
          for (const d of WEIGHT_DISTS)
            best = Math.min(
              best,
              t(car, track, FLAGS_A2, { wing: w, throttle_ramp: r, weight_dist: d }),
            );
        return best;
      });
      const b = argmin(WINGS, (w) => rows[w] ?? Infinity);
      console.log(`${name} best wing ${b.x} | ${rows.map((x) => x.toFixed(3)).join(' ')}`);
    }
  }
}

function TRACK_A2_TRACK(): Track {
  return TRACK_A1;
}
