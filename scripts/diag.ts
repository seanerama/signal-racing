/**
 * Dev-only traces of single runs, used while tuning DEFAULT_CAR values. Not part of the app.
 *
 *   npx --yes tsx scripts/diag.ts launch [ramp] [weight_dist] [every]   A2 launch: spin or not
 *   npx --yes tsx scripts/diag.ts stop [weight_dist] [ramp] [every]     A3 braking: which axle locks
 *   npx --yes tsx scripts/diag.ts corner [A4|B1] [wing] [every]         corner approach, hold, exit
 *   npx --yes tsx scripts/diag.ts a3split [ramp] [pressure]             A3 time = launch + braking
 *
 * `CAR='{"fPeak":6000}'` overrides DEFAULT_CAR values for the run.
 */
import { DEFAULT_CAR } from '../src/engine/car';
import { cornerLimitSpeed } from '../src/engine/corner';
import { powerLimitedTopSpeed } from '../src/engine/physics';
import { simulate } from '../src/engine/simulate';
import type { CarParams, PhysicalColumns, Setup, SimResult, Track } from '../src/engine/types';
import {
  BASE_SETUP,
  CONDITIONS,
  FLAGS_A2,
  TRACK_A1,
  TRACK_A3,
  TRACK_A4,
  TRACK_B1,
} from '../tests/engine/fixtures';

const car: CarParams = {
  ...DEFAULT_CAR,
  ...(JSON.parse(process.env.CAR ?? '{}') as Partial<CarParams>),
};
const [mode = 'launch', a1, a2, a3] = process.argv.slice(2);

function run(track: Track, setup: Partial<Setup>, full = true): SimResult {
  return simulate(
    {
      car,
      setup: { ...BASE_SETUP, ...setup },
      track,
      conditions: CONDITIONS,
      flags: FLAGS_A2,
      seed: 1,
    },
    full ? 'full' : 'fast',
  );
}

function table(c: PhysicalColumns, ids: string[], from: number, every: number, to = c.n): void {
  console.log(['step', 'seg', 's', ...ids].join('  '));
  for (let i = from; i < Math.min(c.n, to); i += every) {
    const cells = ids.map((id) => (c.ch[id]?.[i] ?? NaN).toFixed(3));
    console.log([i, c.seg[i], c.s[i]?.toFixed(2), ...cells].join('  '));
  }
}

function toggles(c: PhysicalColumns): number {
  const b = c.ch.brake ?? new Float32Array(0);
  let n = 0;
  for (let i = 1; i < b.length; i++) if (b[i] !== b[i - 1]) n++;
  return n;
}

if (mode === 'launch') {
  const r = run(TRACK_A1, { throttle_ramp: Number(a1 ?? 0), weight_dist: Number(a2 ?? 0.45) });
  const ids = [
    'speed',
    'throttle',
    'engine_force',
    'grip_budget_rear',
    'rear_slip_ratio',
    'long_g',
  ];
  if (r.columns) table(r.columns, ids, 0, Number(a3 ?? 10), 600);
  console.log(r.outcome);
} else if (mode === 'stop') {
  const r = run(TRACK_A3, { weight_dist: Number(a1 ?? 0.46), throttle_ramp: Number(a2 ?? 0) });
  const c = r.columns;
  if (c) {
    const first = Math.max(
      0,
      (c.ch.brake ?? new Float32Array(0)).findIndex((b) => b > 0),
    );
    console.log(`brake onset step ${first}, brake toggles ${toggles(c)}`);
    const ids = [
      'speed',
      'brake',
      'front_slip_ratio',
      'rear_slip_ratio',
      'load_front',
      'load_rear',
      'grip_budget_front',
      'grip_budget_rear',
      'long_g',
    ];
    table(c, ids, first, Number(a3 ?? 20));
    console.log(`final s ${c.s[c.n - 1]?.toFixed(3)}`);
  }
  console.log(r.outcome);
} else if (mode === 'corner') {
  const track = (a1 ?? 'A4').toUpperCase() === 'B1' ? TRACK_B1 : TRACK_A4;
  const setup: Partial<Setup> = { wing: Number(a2 ?? 4), throttle_ramp: 0.2, weight_dist: 0.46 };
  const radius = track.segments[1]?.radius ?? 80;
  console.log(
    'vLim',
    cornerLimitSpeed(car, { ...BASE_SETUP, ...setup }, CONDITIONS, FLAGS_A2, radius),
  );
  const r = run(track, setup);
  const c = r.columns;
  if (c) {
    console.log(`brake toggles ${toggles(c)}`);
    const first = Math.max(0, (c.ch.brake ?? new Float32Array(0)).findIndex((b) => b > 0) - 20);
    const ids = ['speed', 'throttle', 'brake', 'grip_used_front', 'grip_used_rear', 'lat_g'];
    table(c, ids, first, Number(a3 ?? 10));
  }
  console.log(r.outcome);
} else if (mode === 'a3split') {
  const ramp = Number(a1 ?? 0);
  const p = Number(a2 ?? 1.65);
  console.log('wd     launch   a3       brakeCost');
  for (let i = 0; i <= 28; i++) {
    const d = (38 + 0.5 * i) / 100;
    const s: Partial<Setup> = { weight_dist: d, throttle_ramp: ramp, tire_pressure: p };
    const l = run(TRACK_A1, s, false).outcome.totalTime;
    const a = run(TRACK_A3, s, false).outcome.totalTime;
    console.log(`${d.toFixed(3)}  ${l.toFixed(3)}  ${a.toFixed(3)}  ${(a - l).toFixed(3)}`);
  }
} else if (mode === 'top') {
  const long: Track = {
    id: 'long',
    standingStart: true,
    laps: 1,
    segments: [{ id: 'l', label: 'Long', kind: 'straight', length: Number(a1 ?? 12_000) }],
  };
  for (const wing of [0, 4, 8]) {
    const r = run(long, { wing });
    const c = r.columns;
    const sp = c?.ch.speed ?? new Float32Array(0);
    console.log(
      `wing ${wing}: top ${r.outcome.topSpeed.toFixed(3)} analytic ${powerLimitedTopSpeed(car, wing).toFixed(3)}`,
      `v@10s ${sp[1000]?.toFixed(2)} v@30s ${sp[3000]?.toFixed(2)} t ${r.outcome.totalTime.toFixed(2)}`,
    );
  }
} else if (mode === 'perf') {
  for (const [name, track] of [
    ['A3 1 km', TRACK_A3],
    ['B1-lite', TRACK_B1],
  ] as const) {
    for (const full of [true, false]) {
      for (let i = 0; i < 20; i++) run(track, {}, full);
      const t0 = performance.now();
      const n = 50;
      for (let i = 0; i < n; i++) run(track, {}, full);
      console.log(
        `${name} ${full ? 'full' : 'fast'}: ${((performance.now() - t0) / n).toFixed(2)} ms`,
      );
    }
  }
} else {
  console.log('modes: launch | stop | corner | a3split | top | perf');
}
