/**
 * Fixture `RunTelemetry` / `RunSummary` (contract 03 interfaces only; no Stage 3 code).
 *
 * A small kinematic model drives the fixture track: traction- then power-limited launch, a
 * braking envelope into the corner at its limit speed, a constant-radius corner (so `lat_g`
 * rises through it) and a run-out. The "current" run spins the rears at launch (a
 * `rear_slip_ratio` spike between ~0.3 s and 1.1 s that costs acceleration); the "best" run does
 * not. Noise and NaN dropouts are seeded and deterministic.
 */
import type { ChannelId } from '@/engine/types';
import { createRng } from '@/engine/rng';
import type { ChannelStats, RunSummary, RunTelemetry } from '@/telemetry/types';
import { FIXTURE_META, isPhysical } from './channels';
import {
  FIXTURE_CORNER,
  FIXTURE_LAUNCH,
  FIXTURE_LENGTH,
  FIXTURE_RADIUS,
  FIXTURE_SEGMENT_STARTS,
  fixturePoseAt,
} from './track';

const G = 9.81;
const DT = 0.01;
const MASS = 750;
const POWER = 300_000;
const MU = 1.3;
const V_LIM = Math.sqrt(1.5 * G * FIXTURE_RADIUS);
const DECEL = 1.4 * G;
const H_COG = 0.3;
const WHEELBASE = 3.0;
const REAR_STATIC = 0.45;

export interface RunVariant {
  seed: number;
  /** Peak rear slip during the launch window. */
  slipPeak: number;
  /** Fraction of traction lost while slipping (sliding rubber makes less force). */
  slipLoss: number;
  /** Launch window [t0, t1] in s. */
  slipWindow: [number, number];
}

export const CURRENT_VARIANT: RunVariant = {
  seed: 7,
  slipPeak: 0.18,
  slipLoss: 0.28,
  slipWindow: [0.3, 1.1],
};
export const BEST_VARIANT: RunVariant = {
  seed: 3,
  slipPeak: 0.08,
  slipLoss: 0.02,
  slipWindow: [0.25, 0.9],
};

function bump(t: number, [t0, t1]: [number, number]): number {
  if (t <= t0 || t >= t1) return 0;
  return Math.sin((Math.PI * (t - t0)) / (t1 - t0));
}

function envelope(s: number): number {
  if (s < FIXTURE_LAUNCH) return Math.sqrt(V_LIM * V_LIM + 2 * DECEL * (FIXTURE_LAUNCH - s));
  if (s <= FIXTURE_LAUNCH + FIXTURE_CORNER) return V_LIM;
  return Infinity;
}

/** Clean physical columns for one variant. */
function simulate(v: RunVariant, ids: readonly ChannelId[]) {
  const t: number[] = [];
  const s: number[] = [];
  const speed: number[] = [];
  const accel: number[] = [];
  const slip: number[] = [];
  const braking: number[] = [];
  let vel = 0;
  let pos = 0;
  let time = 0;
  for (let guard = 0; guard < 100_000 && pos < FIXTURE_LENGTH; guard++) {
    const sl = MU * G * (1 - v.slipLoss * bump(time, v.slipWindow));
    const power = vel > 0.5 ? POWER / (MASS * vel) : Infinity;
    const drag = (0.5 * 1.2 * 1.0 * vel * vel) / MASS;
    let a = Math.min(sl, power) - drag;
    let next = vel + a * DT;
    const env = envelope(pos + vel * DT);
    let brk = 0;
    if (next > env) {
      next = Math.max(env, vel - DECEL * DT);
      a = (next - vel) / DT;
      brk = Math.min(1, Math.max(0, -a / DECEL));
    }
    t.push(time);
    s.push(pos);
    speed.push(vel);
    accel.push(a);
    slip.push(0.03 + (v.slipPeak - 0.03) * bump(time, v.slipWindow) + (brk > 0 ? 0.01 : 0));
    braking.push(brk);
    pos += (vel + next) * 0.5 * DT;
    vel = next;
    time += DT;
  }
  const n = t.length;
  const seg = new Uint8Array(n);
  const cols: Record<ChannelId, Float32Array> = {};
  const col = (id: ChannelId, f: (i: number) => number) => {
    if (!ids.includes(id)) return;
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = f(i);
    cols[id] = arr;
  };
  const cornerBlend = (d: number) => {
    const c0 = FIXTURE_LAUNCH;
    const c1 = FIXTURE_LAUNCH + FIXTURE_CORNER;
    if (d <= c0 || d >= c1) return 0;
    return Math.min(1, (d - c0) / 12, (c1 - d) / 12);
  };
  const tireTemp: number[] = [];
  let temp = 62;
  for (let i = 0; i < n; i++) {
    const sp = speed[i] as number;
    temp +=
      ((slip[i] as number) * sp * 0.9 + (braking[i] as number) * 0.4 - (temp - 60) * 0.004) *
      DT *
      10;
    tireTemp.push(temp);
    const d = s[i] as number;
    seg[i] = d < FIXTURE_SEGMENT_STARTS[1]! ? 0 : d < FIXTURE_SEGMENT_STARTS[2]! ? 1 : 2;
  }
  const latG = (i: number) => {
    const sp = speed[i] as number;
    return ((sp * sp) / (FIXTURE_RADIUS * G)) * cornerBlend(s[i] as number);
  };
  const gearOf = (sp: number) => Math.min(6, 1 + Math.floor(sp / 9));
  col('speed', (i) => speed[i]!);
  col('long_g', (i) => accel[i]! / G);
  col('lat_g', latG);
  col('rear_slip_ratio', (i) => slip[i]!);
  col('front_slip_ratio', (i) => 0.01 + braking[i]! * 0.05);
  col('wheel_speed_fl', (i) => speed[i]!);
  col('wheel_speed_fr', (i) => speed[i]!);
  col('wheel_speed_rl', (i) => speed[i]! * (1 + slip[i]!) + (i < 30 ? slip[i]! * 3 : 0));
  col('wheel_speed_rr', (i) => speed[i]! * (1 + slip[i]! * 0.95));
  col('gear', (i) => gearOf(speed[i]!));
  col('engine_rpm', (i) => {
    const sp = speed[i]! * (1 + slip[i]!);
    const g = gearOf(speed[i]!);
    return Math.min(12_500, 4_000 + ((sp - (g - 1) * 9) / 9) * 7_500 + (g === 1 ? 1500 : 0));
  });
  col('throttle', (i) => (braking[i]! > 0 ? 0 : cornerBlend(s[i]!) > 0 ? 0.35 : 1));
  col('brake', (i) => braking[i]!);
  col('tire_temp_rl', (i) => tireTemp[i]!);
  col('tire_temp_rr', (i) => tireTemp[i]! - 1.5);
  col('tire_temp_fl', (i) => 60 + (tireTemp[i]! - 62) * 0.4);
  col('tire_temp_fr', (i) => 60 + (tireTemp[i]! - 62) * 0.45);
  col('load_rear', (i) => MASS * G * REAR_STATIC + (MASS * accel[i]! * H_COG) / WHEELBASE);
  col('load_front', (i) => MASS * G * (1 - REAR_STATIC) - (MASS * accel[i]! * H_COG) / WHEELBASE);
  col('grip_used_rear', (i) =>
    Math.min(1, Math.hypot(Math.max(0, accel[i]!) / (MU * G), latG(i) / 1.5)),
  );
  col('grip_used_front', (i) => Math.min(1, Math.hypot(braking[i]!, latG(i) / 1.5)));
  col('steering_angle', (i) => ((WHEELBASE / FIXTURE_RADIUS) * 180 * cornerBlend(s[i]!)) / Math.PI);
  col('yaw_rate', (i) => ((speed[i]! / FIXTURE_RADIUS) * 180 * cornerBlend(s[i]!)) / Math.PI);
  col('downforce', (i) => 0.5 * 1.2 * 3 * speed[i]! ** 2);
  col('drag_force', (i) => 0.5 * 1.2 * 1.0 * speed[i]! ** 2);
  col('power_used', (i) => Math.max(0, MASS * accel[i]! * speed[i]!));
  col('pos_x', (i) => fixturePoseAt(s[i]!).x);
  col('pos_y', (i) => fixturePoseAt(s[i]!).y);
  col('heading', (i) => fixturePoseAt(s[i]!).heading);

  // Distractors: functions of (t, s, throttle, speed) only.
  const rng = createRng(v.seed ^ 0x5eed);
  for (const id of ids) {
    if (cols[id] || isPhysical(id)) continue;
    const r = rng.fork(`distractor:${id}`);
    const base = 20 + r.next() * 80;
    const amp = 0.5 + r.next() * 4;
    const freq = 0.2 + r.next() * 1.5;
    const phase = r.next() * Math.PI * 2;
    const drift = r.next() * 0.6;
    const echo = r.next() < 0.25 ? r.next() * 0.3 : 0;
    const q = FIXTURE_META[id]?.quantity;
    const scale = q === 'percent' ? 0.01 : q === 'pressure' ? 0.04 : q === 'distance' ? 0.002 : 1;
    col(id, (i) => {
      const ti = t[i]!;
      return (base + amp * Math.sin(freq * ti + phase) + drift * ti + echo * speed[i]!) * scale;
    });
  }
  return { n, t: Float32Array.from(t), s: Float32Array.from(s), seg, cols };
}

/** NaN-free channels: no noise, no dropouts (pose is clean so the block never jumps). */
const NOISELESS = new Set<ChannelId>(['pos_x', 'pos_y', 'heading', 'gear', 'throttle', 'brake']);

/** Builds a fixture `RunTelemetry` for `ids`. Deterministic for a given variant. */
export function makeFixtureRun(variant: RunVariant, ids: readonly ChannelId[]): RunTelemetry {
  const sim = simulate(variant, ids);
  const cache = new Map<ChannelId, Float32Array>();
  const rng = createRng(variant.seed);
  const rt: RunTelemetry = {
    n: sim.n,
    dt: DT,
    t: sim.t,
    s: sim.s,
    seg: sim.seg,
    channelIds: [...ids],
    getClean(id) {
      const c = sim.cols[id];
      if (!c) throw new Error(`fixture: unknown channel ${id}`);
      return c;
    },
    get(id) {
      const hit = cache.get(id);
      if (hit) return hit;
      const clean = rt.getClean(id);
      if (NOISELESS.has(id)) {
        cache.set(id, clean);
        return clean;
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of clean) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      const sigma = Math.max(1e-6, (hi - lo) * 0.012);
      const r = rng.fork(`noise:${id}`);
      const out = new Float32Array(clean.length);
      for (let i = 0; i < clean.length; i++) {
        out[i] = r.next() < 0.002 ? NaN : (clean[i] as number) + r.normal() * sigma;
      }
      cache.set(id, out);
      return out;
    },
  };
  return rt;
}

function stats(arr: Float32Array, t: Float32Array, from = 0, to = arr.length): ChannelStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  let argmin = -1;
  let argmax = -1;
  let dropouts = 0;
  for (let i = from; i < to; i++) {
    const v = arr[i] as number;
    if (Number.isNaN(v)) {
      dropouts++;
      continue;
    }
    if (v < min) {
      min = v;
      argmin = i;
    }
    if (v > max) {
      max = v;
      argmax = i;
    }
    sum += v;
    count++;
  }
  return {
    min: count ? min : NaN,
    max: count ? max : NaN,
    mean: count ? sum / count : NaN,
    argmin,
    argmax,
    tMin: argmin >= 0 ? (t[argmin] as number) : NaN,
    tMax: argmax >= 0 ? (t[argmax] as number) : NaN,
    dropouts,
  };
}

/** NaN-safe fixture summary (the contract 03 shape). */
export function summarizeFixture(rt: RunTelemetry): RunSummary {
  const ids = rt.channelIds;
  const st: Record<ChannelId, ChannelStats> = {};
  const clean: Record<ChannelId, ChannelStats> = {};
  for (const id of ids) {
    st[id] = stats(rt.get(id), rt.t);
    clean[id] = stats(rt.getClean(id), rt.t);
  }
  const segCount = rt.n > 0 ? (rt.seg[rt.n - 1] as number) + 1 : 0;
  const perSegment: Array<Record<ChannelId, ChannelStats>> = [];
  for (let k = 0; k < segCount; k++) {
    let from = -1;
    let to = -1;
    for (let i = 0; i < rt.n; i++) {
      if (rt.seg[i] === k) {
        if (from < 0) from = i;
        to = i + 1;
      }
    }
    const rec: Record<ChannelId, ChannelStats> = {};
    for (const id of ids) rec[id] = stats(rt.get(id), rt.t, Math.max(0, from), Math.max(0, to));
    perSegment.push(rec);
  }
  return {
    stats: st,
    clean,
    perSegment,
    window(id, pred) {
      const c = rt.getClean(id);
      let first = -1;
      let last = -1;
      for (let i = 0; i < c.length; i++) {
        if (pred(c[i] as number)) {
          if (first < 0) first = i;
          last = i;
        }
      }
      return first < 0 ? null : { tStart: rt.t[first] as number, tEnd: rt.t[last] as number };
    },
  };
}

/** Total time of a fixture run (last sample's t). */
export function runTime(rt: RunTelemetry): number {
  return rt.n > 0 ? (rt.t[rt.n - 1] as number) : NaN;
}
