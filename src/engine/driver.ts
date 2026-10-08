/**
 * The driver model (contract 02 "Driver braking" and "Driver in corners").
 *
 * A backward pass in distance builds the speed envelope `v_env(s)`: the fastest speed from which
 * full braking (the same row-12 force function the car uses, load transfer from the implied
 * deceleration, downforce included) still reaches every later target: each corner's limit speed
 * (row 21) and each stop point (0). Forward integration then brakes at full pedal once
 * `v ≥ v_env(s)`, holds the corner limit speed through corners, and otherwise drives at the
 * player's throttle ramp.
 */
import { DT, ENVELOPE_DS, V_UNBOUNDED } from './constants';
import {
  computeGrip,
  cornerLimitSpeedCtx,
  createGripContext,
  createGripState,
  type GripContext,
  type GripState,
} from './corner';
import {
  brakeDemand,
  rollingForce,
  throttle as rampThrottle,
  tireForce,
  topSpeed,
  type AxlePair,
  type TireForceResult,
} from './physics';
import { curvature, segmentAt, trackLayout, type TrackLayout } from './track';
import type { CarParams, Conditions, ModelFlags, Setup, Track } from './types';

/**
 * m/s. Once braking, the driver stays on the pedal until the car is this far below the envelope.
 * It stops the bang-bang chatter that one-step discretisation error would otherwise cause.
 */
export const BRAKE_LATCH = 0.3;

/** Fixed-point iterations for the deceleration ↔ load-transfer coupling in the envelope. */
const DECEL_ITERATIONS = 8;

/** Limit speed per segment (row 21; `Infinity` for straights). */
export function segmentLimitSpeeds(ctx: GripContext, track: Track): number[] {
  return track.segments.map((seg) =>
    seg.kind === 'corner' && seg.radius ? cornerLimitSpeedCtx(ctx, seg.radius) : Infinity,
  );
}

/**
 * Full-pedal deceleration (m/s², positive) at speed `v` on curvature `kappa`: row 11 at β = 1
 * through row 12 on each axle (within the row-20 friction circle), plus drag and rolling.
 * Load transfer uses the implied deceleration, solved by damped fixed-point iteration.
 */
export function brakingDecel(
  ctx: GripContext,
  v: number,
  kappa: number,
  g: GripState = createGripState(),
): number {
  const { car, mass } = ctx;
  const roll = rollingForce(car);
  const demand: AxlePair = brakeDemand(car, 1);
  const tf: TireForceResult = { force: 0, slip: 0, sliding: false };
  let a = (car.brakeForceMax + roll) / mass;
  for (let k = 0; k < DECEL_ITERATIONS; k++) {
    computeGrip(ctx, v, -a, kappa, null, g);
    const ff = tireForce(car, demand.front, g.fxMaxFront, tf).force;
    const fr = tireForce(car, demand.rear, g.fxMaxRear, tf).force;
    const next = (ff + fr + g.fDrag + roll) / mass;
    a = k === 0 ? next : 0.5 * (a + next);
  }
  return a;
}

/** The envelope plus what is needed to read it. */
export interface Envelope {
  /** m/s at `s = k·ds`. */
  v: Float32Array;
  ds: number;
  /** m, track length. */
  total: number;
  /** True if the last segment ends with a stop (beyond the end the envelope is 0). */
  stopAtEnd: boolean;
}

/** Envelope from a prepared context and layout (shared with `simulate`). */
export function buildEnvelope(
  ctx: GripContext,
  layout: TrackLayout,
  limits: readonly number[],
  vReach: number,
): Envelope {
  const { segments, starts, ends, total } = layout;
  const n = Math.ceil(total / ENVELOPE_DS - 1e-9) + 1;
  const cap = new Float64Array(n).fill(V_UNBOUNDED);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const s0 = starts[i] ?? 0;
    const s1 = ends[i] ?? 0;
    const lim = limits[i] ?? Infinity;
    if (seg?.kind === 'corner' && Number.isFinite(lim)) {
      // Every grid point on the closed interval [s0, s1]: the car must be at v_lim on entry.
      const k0 = Math.max(0, Math.ceil(s0 / ENVELOPE_DS - 1e-9));
      const k1 = Math.min(n - 1, Math.floor(s1 / ENVELOPE_DS + 1e-9));
      for (let k = k0; k <= k1; k++) cap[k] = Math.min(cap[k] ?? lim, lim);
    }
    if (seg?.endsWithStop) {
      const ks = Math.min(n - 1, Math.round(s1 / ENVELOPE_DS));
      cap[ks] = 0;
      if (i === segments.length - 1) for (let k = ks; k < n; k++) cap[k] = 0;
    }
  }

  const v = new Float32Array(n);
  const g = createGripState();
  let hint = segments.length - 1;
  let next = cap[n - 1] ?? V_UNBOUNDED;
  v[n - 1] = next;
  for (let k = n - 2; k >= 0; k--) {
    let vk = cap[k] ?? V_UNBOUNDED;
    if (next < V_UNBOUNDED) {
      const s1 = (k + 1) * ENVELOPE_DS;
      hint = segmentAt(layout, Math.min(s1, total), hint);
      const seg = segments[hint];
      const kappa = seg ? curvature(seg) : 0;
      const a = brakingDecel(ctx, next, kappa, g);
      const reach = Math.sqrt(next * next + 2 * Math.max(a, 0) * ENVELOPE_DS);
      if (reach < vk) vk = reach;
    }
    // Speeds the car can never reach need no further braking computation.
    if (vk > vReach) vk = V_UNBOUNDED;
    v[k] = vk;
    next = vk;
  }
  return {
    v,
    ds: ENVELOPE_DS,
    total,
    stopAtEnd: segments[segments.length - 1]?.endsWithStop === true,
  };
}

/** `v_env(s)` over `s` at `ds = 0.25 m` (contract 02 "Driver braking"). */
export function brakingEnvelope(
  track: Track,
  car: CarParams,
  setup: Setup,
  conditions: Conditions,
  flags: ModelFlags,
): Float32Array {
  const ctx = createGripContext(car, setup, conditions, flags);
  const layout = trackLayout(track);
  const vReach = 1.1 * topSpeed(car, setup.wing);
  return buildEnvelope(ctx, layout, segmentLimitSpeeds(ctx, track), vReach).v;
}

/** Envelope speed at `s`, interpolated linearly in v² (exact for constant deceleration). */
export function envelopeAt(env: Envelope, s: number): number {
  if (s >= env.total) return env.stopAtEnd ? 0 : (env.v[env.v.length - 1] ?? V_UNBOUNDED);
  if (s <= 0) return env.v[0] ?? V_UNBOUNDED;
  const x = s / env.ds;
  const i = Math.floor(x);
  const a = env.v[i] ?? V_UNBOUNDED;
  const b = env.v[i + 1] ?? a;
  if (a >= V_UNBOUNDED || b >= V_UNBOUNDED)
    return Math.min(a, b) >= V_UNBOUNDED ? V_UNBOUNDED : Math.max(a, b);
  const f = x - i;
  return Math.sqrt(a * a + (b * b - a * a) * f);
}

/** What the driver knows at the start of a step. */
export interface DriverState {
  s: number;
  v: number;
  /** s since the last launch (standing start or relaunch after a stop). */
  tSinceLaunch: number;
  /** Player lever, s. */
  ramp: number;
  /** Was the pedal down last step (for the latch)? */
  braking: boolean;
  /** Limit speed of the current corner (row 21), `Infinity` on a straight. */
  vLim: number;
  /** m, the stop point of the current segment, `Infinity` if it does not end with a stop. */
  stopAt: number;
  mass: number;
  /** N, `min(fPeak, P/max(v, 0.5))`: engine force at full throttle. */
  engineFull: number;
  /** N, drag + rolling resistance at `v`. */
  resistance: number;
  /** N, longitudinal force the rear axle can take in the corner (row 20). */
  fxMaxRear: number;
}

/** Pedal outputs. `throttle` ∈ [0, 1] is the actual throttle; `brake` β ∈ {0, 1}. */
export interface DriverInputs {
  throttle: number;
  brake: number;
}

/**
 * The driver for one step. Brakes at full pedal when `v ≥ v_env(s)` (latched by `BRAKE_LATCH`)
 * or past a stop point; once braking for a stop it stays on the pedal until stopped (a release
 * near standstill would crawl and add time noise). In a corner it holds `v_lim`, using throttle only to cancel drag and
 * rolling resistance (plus closing any gap to `v_lim` in one step), capped by the friction circle.
 * Otherwise it follows the throttle ramp (row 9).
 */
export function driverInputs(
  state: DriverState,
  envelope: Envelope,
  out: DriverInputs = { throttle: 0, brake: 0 },
): DriverInputs {
  const { s, v } = state;
  const vEnv = envelopeAt(envelope, s);
  const inCorner = Number.isFinite(state.vLim);
  let brake = false;
  if (s >= state.stopAt || (state.braking && Number.isFinite(state.stopAt))) {
    // Past the stop point, or already braking for it: stay on the pedal until stopped.
    brake = v > 0;
  } else if (inCorner && vEnv >= state.vLim - 1e-6) {
    brake = false; // holding the corner: the hold controller manages speed
  } else if (v >= vEnv || (state.braking && v > vEnv - BRAKE_LATCH)) {
    brake = true;
  }
  if (brake) {
    out.brake = 1;
    out.throttle = 0;
    return out;
  }
  out.brake = 0;
  let theta = rampThrottle(state.tSinceLaunch, state.ramp, false);
  if (inCorner && state.engineFull > 0) {
    const target = Math.min(state.vLim, vEnv);
    const need = Math.max(0, state.resistance + (state.mass * (target - v)) / DT);
    const cap = Math.min(need, state.fxMaxRear);
    theta = Math.min(theta, cap / state.engineFull);
  }
  out.throttle = theta;
  return out;
}
