/**
 * Synthetic `PhysicalColumns` for telemetry tests (Stage 3 is built before the engine lands).
 *
 * A plausible launch → (corner) → stop trace from simple closed-form curves: a throttle ramp,
 * `a = a_max·θ·(1 − (v/v_max)²)`, a constant-deceleration braking envelope into corners and the stop
 * point, and a held speed through corners. Every contract-02 physical channel is filled with values
 * of the right shape and magnitude. Varying `rampTime`, `vmax`, `accel` stands in for setups.
 */
import type { ChannelId, PhysicalColumns } from '@/engine/types';
import { PHYSICAL_CHANNEL_IDS } from '@/telemetry/physical-defs';

export interface FixtureSegment {
  kind: 'straight' | 'corner';
  /** m. */
  length: number;
  /** m, corner only. */
  radius?: number;
  /** m/s, corner hold speed. */
  vlim?: number;
  direction?: 'left' | 'right';
}

export interface FixtureOptions {
  segments?: FixtureSegment[];
  /** s. */
  rampTime?: number;
  /** m/s, power-limited top speed. */
  vmax?: number;
  /** m/s², peak launch acceleration. */
  accel?: number;
  /** m/s², braking deceleration. */
  decel?: number;
  /** Stop at the end of the last segment. */
  stop?: boolean;
  dt?: number;
}

const G = 9.81;
const MASS = 750;
const WHEELBASE = 3;
const COG = 0.3;

export function makeFixture(opts: FixtureOptions = {}): PhysicalColumns {
  const segments = opts.segments ?? [{ kind: 'straight', length: 1000 }];
  const rampTime = opts.rampTime ?? 0.6;
  const vmax = opts.vmax ?? 80;
  const accel = opts.accel ?? 11;
  const decel = opts.decel ?? 14;
  const stop = opts.stop ?? true;
  const dt = opts.dt ?? 0.01;

  const bounds: number[] = [];
  let acc = 0;
  for (const seg of segments) bounds.push((acc += seg.length));
  const total = acc;
  const segStart = (k: number) => (k === 0 ? 0 : bounds[k - 1]!);

  const rows: Record<string, number>[] = [];
  let v = 0;
  let s = 0;
  let t = 0;
  let x = 0;
  let y = 0;
  let heading = 0; // deg, 0 = +x
  let launchT = 0;
  const tireT = [30, 30, 30, 30];
  const brakeT = [60, 60];
  let a = 0;

  for (let step = 0; step < 300 / dt; step++) {
    let k = bounds.findIndex((b) => s < b);
    if (k < 0) k = segments.length - 1;
    const seg = segments[k]!;
    const inCorner = seg.kind === 'corner';
    const vlim = inCorner ? (seg.vlim ?? 30) : 0;

    // Braking envelope: the next speed target ahead (corner entry or the stop point).
    let brake = 0;
    for (let j = k + (inCorner ? 1 : 0); j < segments.length; j++) {
      const sj = segments[j]!;
      if (sj.kind !== 'corner') continue;
      const dist = segStart(j) - s;
      if (dist > 0 && v * v > (sj.vlim ?? 30) ** 2 + 2 * decel * dist) brake = 1;
      break;
    }
    if (stop && v * v >= 2 * decel * Math.max(0, total - s) && s > total - 400) brake = 1;

    const theta = Math.min(1, rampTime === 0 ? 1 : (t - launchT) / rampTime);
    let throttle = brake ? 0 : theta;
    if (brake) a = -decel;
    else if (inCorner && v >= vlim) {
      throttle = 0.3;
      a = 0;
      v = vlim;
    } else a = accel * throttle * (1 - (v / vmax) ** 2);

    // Channels at this sample.
    const drag = 0.5 * 1.225 * 1.0 * v * v;
    const down = 0.5 * 1.225 * 3.0 * v * v;
    const ay = inCorner ? (v * v) / (seg.radius ?? 80) : 0;
    const dN = (MASS * a * COG) / WHEELBASE;
    const nF = Math.max(0, 0.55 * MASS * G + 0.45 * down - dN);
    const nR = Math.max(0, 0.45 * MASS * G + 0.55 * down + dN);
    const lat = (MASS * ay * COG) / 1.9 / 2;
    const sign = seg.direction === 'left' ? 1 : -1;
    const loads = [
      nF / 2 - sign * lat,
      nF / 2 + sign * lat,
      nR / 2 - sign * lat,
      nR / 2 + sign * lat,
    ].map((l) => Math.max(0, l));
    const mu = 1.6;
    const budgetF = mu * nF;
    const budgetR = mu * nR;
    const fEng = throttle * Math.min(10000, 500000 / Math.max(v, 0.5));
    const fx = MASS * a;
    const usedR = Math.min(1, Math.hypot(Math.max(0, fx), MASS * ay * 0.45) / Math.max(budgetR, 1));
    const usedF = Math.min(
      1,
      Math.hypot(Math.min(0, fx) * 0.55, MASS * ay * 0.55) / Math.max(budgetF, 1),
    );
    const slipR = brake ? 0.02 : 0.1 * usedR;
    const slipF = brake ? 0.08 : 0;
    const gear = 1 + Math.floor(Math.min(5, v / 15));
    for (let w = 0; w < 4; w++) {
      const used = w < 2 ? usedF : usedR;
      tireT[w]! += (0.9 * used * used * v - 0.02 * (tireT[w]! - 30)) * dt;
    }
    brakeT[0]! += (2e-6 * brake * 8800 * v - 0.05 * (brakeT[0]! - 25)) * dt;
    brakeT[1]! += (2e-6 * brake * 7200 * v - 0.05 * (brakeT[1]! - 25)) * dt;

    rows.push({
      t,
      s,
      seg: k,
      speed: v,
      long_g: a / G,
      drag_force: drag,
      downforce: down,
      engine_force: fEng,
      throttle,
      brake,
      engine_rpm: 4000 + ((v - 15 * (gear - 1)) / 15) * 8000,
      gear,
      load_fl: loads[0]!,
      load_fr: loads[1]!,
      load_rl: loads[2]!,
      load_rr: loads[3]!,
      lat_g: ay / G,
      steering_angle: inCorner ? (WHEELBASE / (seg.radius ?? 80)) * (180 / Math.PI) : 0,
      heading,
      grip_budget_front: budgetF,
      grip_budget_rear: budgetR,
      grip_used_front: usedF,
      grip_used_rear: usedR,
      fx_front: Math.min(0, fx) * 0.55,
      fy_front: MASS * ay * 0.55,
      fx_rear: Math.max(0, fx),
      fy_rear: MASS * ay * 0.45,
      front_slip_ratio: slipF,
      rear_slip_ratio: slipR,
      wheel_speed_fl: v * (1 - slipF),
      wheel_speed_fr: v * (1 - slipF),
      wheel_speed_rl: brake ? v * (1 - slipR) : v * (1 + slipR),
      wheel_speed_rr: brake ? v * (1 - slipR) : v * (1 + slipR),
      tire_temp_fl: tireT[0]!,
      tire_temp_fr: tireT[1]!,
      tire_temp_rl: tireT[2]!,
      tire_temp_rr: tireT[3]!,
      brake_temp_front: brakeT[0]!,
      brake_temp_rear: brakeT[1]!,
      mu_front: mu,
      mu_rear: mu,
      rolling_force: 0.015 * MASS * G,
      power_used: fEng * v,
      load_front: nF,
      load_rear: nR,
      yaw_rate: inCorner ? (v / (seg.radius ?? 80)) * (180 / Math.PI) : 0,
      pos_x: x,
      pos_y: y,
      corner_limit_speed: vlim,
    });

    // Integrate.
    const vNew = Math.max(0, v + a * dt);
    const ds = 0.5 * (v + vNew) * dt;
    s += ds;
    if (inCorner) heading += (sign * (ds / (seg.radius ?? 80)) * 180) / Math.PI;
    x += ds * Math.cos((heading * Math.PI) / 180);
    y += ds * Math.sin((heading * Math.PI) / 180);
    v = vNew;
    t += dt;
    if (brake && v < 0.05 && stop && s > total - 5) break;
    if (!stop && s >= total) break;
    if (v === 0 && brake && s < total - 5) launchT = t; // relaunch after an early stop
  }

  const n = rows.length;
  const tArr = new Float32Array(n);
  const sArr = new Float32Array(n);
  const segArr = new Uint8Array(n);
  const ch: Record<ChannelId, Float32Array> = {};
  for (const id of PHYSICAL_CHANNEL_IDS) ch[id] = new Float32Array(n);
  rows.forEach((r, i) => {
    tArr[i] = r.t!;
    sArr[i] = r.s!;
    segArr[i] = r.seg!;
    for (const id of PHYSICAL_CHANNEL_IDS) ch[id]![i] = r[id]!;
  });
  return { n, dt, t: tArr, s: sArr, seg: segArr, ch };
}

/** Three segments: run-up, a right-hander (r = 80 m), run-out to a stop. */
export const CORNER_TRACK: FixtureSegment[] = [
  { kind: 'straight', length: 400 },
  { kind: 'corner', length: 125, radius: 80, vlim: 32, direction: 'right' },
  { kind: 'straight', length: 400 },
];

/** Time to the end of the run (the stand-in for `Outcome.totalTime`). */
export function totalTime(pc: PhysicalColumns): number {
  return pc.t[pc.n - 1]!;
}

/** Pearson correlation, skipping pairs with a NaN. */
export function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    n++;
    sa += x;
    sb += y;
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    cov += (x - ma) * (y - mb);
    va += (x - ma) ** 2;
    vb += (y - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

/** Population standard deviation, skipping NaN. */
export function std(a: ArrayLike<number>): number {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]!)) continue;
    n++;
    sum += a[i]!;
  }
  const m = sum / n;
  let v = 0;
  for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i]!)) v += (a[i]! - m) ** 2;
  return Math.sqrt(v / n);
}
