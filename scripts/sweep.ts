/**
 * Dev-only lever sweep: prints lever vs time tables so the tradeoffs can be seen and the
 * DEFAULT_CAR values tuned. Not part of the app or the test suite.
 *
 *   npx --yes tsx scripts/sweep.ts A2
 *   CAR='{"fPeak":9000}' npx --yes tsx scripts/sweep.ts A3
 *
 * Levels: A1, A2, A3, A4, B1 (B1-lite), ALL.
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

const overrides = JSON.parse(process.env.CAR ?? '{}') as Partial<CarParams>;
const car: CarParams = { ...DEFAULT_CAR, ...overrides };

interface Run {
  time: number;
  maxFrontSlip: number;
  maxRearSlip: number;
  stopPos: number;
  vmin: number;
}

function run(track: Track, flags: ModelFlags, setup: Partial<Setup>): Run {
  const res = simulate(
    { car, setup: { ...BASE_SETUP, ...setup }, track, conditions: CONDITIONS, flags, seed: 1 },
    'full',
  );
  const ch = res.columns?.ch ?? {};
  const max = (a: Float32Array | undefined): number =>
    a ? a.reduce((m, x) => Math.max(m, x), 0) : 0;
  const sCol = res.columns?.s;
  const speed = ch.speed;
  const cls = ch.corner_limit_speed;
  let vmin = Infinity;
  if (speed && cls)
    for (let i = 0; i < speed.length; i++)
      if ((cls[i] ?? 0) > 0) vmin = Math.min(vmin, speed[i] ?? 0);
  return {
    time: res.outcome.totalTime,
    maxFrontSlip: max(ch.front_slip_ratio),
    maxRearSlip: max(ch.rear_slip_ratio),
    stopPos: sCol ? (sCol[sCol.length - 1] ?? 0) : 0,
    vmin,
  };
}

const f = (x: number, d = 3): string => x.toFixed(d);

function bestOf<T>(xs: T[], time: (x: T) => number): T {
  let best = xs[0] as T;
  for (const x of xs) if (time(x) < time(best)) best = x;
  return best;
}

function spread(times: number[]): string {
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  return `${f(((hi - lo) / lo) * 100, 2)}%`;
}

function sweepA1(): void {
  console.log('\n## A1: throttle_ramp (traction off), pressure 1.65, wd 0.45, wing 4');
  console.log('ramp  time');
  for (const r of RAMPS)
    console.log(`${f(r, 1)}  ${f(run(TRACK_A1, FLAGS_A1, { throttle_ramp: r }).time)}`);
}

function sweepA2(): void {
  console.log('\n## A2: throttle_ramp at p = pOpt (1.65), wd 0.45, wing 4');
  console.log('ramp  time     maxRearSlip');
  const rows = RAMPS.map((r) => ({ r, ...run(TRACK_A1, FLAGS_A2, { throttle_ramp: r }) }));
  for (const x of rows) console.log(`${f(x.r, 1)}  ${f(x.time)}  ${f(x.maxRearSlip)}`);
  const best = bestOf(rows, (x) => x.time);
  console.log(`best ramp ${f(best.r, 1)}  spread ${spread(rows.map((x) => x.time))}`);

  console.log(`\n## A2: tire_pressure at best ramp per pressure (ramp grid searched)`);
  console.log('p     bestRamp  time');
  const prow = PRESSURES.map((p) => {
    const rs = RAMPS.map((r) => ({
      r,
      t: run(TRACK_A1, FLAGS_A2, { throttle_ramp: r, tire_pressure: p }).time,
    }));
    const b = bestOf(rs, (x) => x.t);
    return { p, r: b.r, t: b.t };
  });
  for (const x of prow) console.log(`${f(x.p, 1)}   ${f(x.r, 1)}       ${f(x.t)}`);
  console.log(`best p ${f(bestOf(prow, (x) => x.t).p, 1)}  spread ${spread(prow.map((x) => x.t))}`);
}

function sweepA3(): void {
  console.log('\n## A3: weight_dist (ramp grid-searched per d, p = 1.65, wing 4)');
  console.log('wd    bestRamp  time     maxFrontSlip  maxRearSlip  stopPos');
  const rows = WEIGHT_DISTS.map((d) => {
    const rs = RAMPS.map((r) => ({
      r,
      ...run(TRACK_A3, FLAGS_A2, { throttle_ramp: r, weight_dist: d }),
    }));
    return { d, ...bestOf(rs, (x) => x.time) };
  });
  for (const x of rows) {
    console.log(
      `${f(x.d, 2)}  ${f(x.r, 1)}       ${f(x.time)}  ${f(x.maxFrontSlip)}         ${f(x.maxRearSlip)}        ${f(x.stopPos, 2)}`,
    );
  }
  console.log(
    `best wd ${f(bestOf(rows, (x) => x.time).d, 2)}  spread ${spread(rows.map((x) => x.time))}`,
  );
}

function sweepWing(name: string, track: Track): void {
  console.log(`\n## ${name}: wing (ramp and wd grid-searched per wing, p = 1.65)`);
  console.log('wing  ramp  wd    time     vCornerMin');
  const rows = WINGS.map((w) => {
    const cands = [];
    for (const r of [0, 0.2, 0.4, 0.6, 1.0])
      for (const d of WEIGHT_DISTS)
        cands.push({
          w,
          r,
          d,
          ...run(track, FLAGS_A2, { wing: w, throttle_ramp: r, weight_dist: d }),
        });
    return bestOf(cands, (x) => x.time);
  });
  for (const x of rows)
    console.log(`${x.w}     ${f(x.r, 1)}   ${f(x.d, 2)}  ${f(x.time)}  ${f(x.vmin, 2)}`);
  console.log(
    `best wing ${bestOf(rows, (x) => x.time).w}  spread ${spread(rows.map((x) => x.time))}`,
  );
}

const which = (process.argv[2] ?? 'ALL').toUpperCase();
if (Object.keys(overrides).length) console.log('car overrides:', overrides);
if (which === 'A1' || which === 'ALL') sweepA1();
if (which === 'A2' || which === 'ALL') sweepA2();
if (which === 'A3' || which === 'ALL') sweepA3();
if (which === 'A4' || which === 'ALL') sweepWing('A4', TRACK_A4);
if (which === 'B1' || which === 'ALL') sweepWing('B1-lite', TRACK_B1);
