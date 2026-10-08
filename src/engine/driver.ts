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
  engineForce,
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

/** Passes of the row-12b slide-state resolution in `brakingDecel` (each settles one change). */
const SLIDE_PASSES = 4;

/** Row-12b slide state under braking, as bits: 1 = front axle sliding, 2 = rear axle sliding. */
export type BrakeSlideState = number;

/** m/s, speed step of the slide-state sweep (`brakingSweep`). */
export const SLIDE_DV = 0.25;

/** m/s, width of the onset-speed bands of the braking envelope (`buildEnvelope`). */
export const ONSET_DV = 5;

/**
 * Full-pedal deceleration (m/s², positive) at speed `v` on curvature `kappa`: row 11 at β = 1
 * through row 12 on each axle (within the row-20 friction circle), plus drag and rolling.
 * Load transfer uses the implied deceleration.
 *
 * Row 12b (slide hysteresis): `state` is the slide state the axles arrive with (default: both
 * gripping, a fresh pedal). A gripping axle whose demand ratio exceeds 1 breaks away, and a
 * sliding axle stays sliding while its ratio is at least `kRegrip`; each change moves the
 * deceleration and so the loads, and is re-checked. With both axles gripping the deceleration is
 * exact; with a sliding axle the deceleration ↔ load-transfer coupling is solved by damped
 * fixed-point iteration. This is the steady-state view (tests, diagnostics); the envelope uses
 * `brakingSweep`, which follows the integrator's step-by-step lag through a braking zone.
 */
export function brakingDecel(
  ctx: GripContext,
  v: number,
  kappa: number,
  g: GripState = createGripState(),
  state: BrakeSlideState = 0,
): number {
  const { car, mass } = ctx;
  const roll = rollingForce(car);
  const demand: AxlePair = brakeDemand(car, 1);
  const tf: TireForceResult = { force: 0, slip: 0, sliding: false };
  let slideF = (state & 1) !== 0;
  let slideR = (state & 2) !== 0;
  let a = (demand.front + demand.rear + roll) / mass;
  for (let pass = 0; pass < SLIDE_PASSES; pass++) {
    if (!slideF && !slideR) {
      computeGrip(ctx, v, 0, kappa, null, g); // drag only; loads are recomputed below
      a = (demand.front + demand.rear + g.fDrag + roll) / mass;
    } else {
      for (let k = 0; k < DECEL_ITERATIONS; k++) {
        computeGrip(ctx, v, -a, kappa, null, g);
        const ff = slideF ? car.slideFactor * g.fxMaxFront : demand.front;
        const fr = slideR ? car.slideFactor * g.fxMaxRear : demand.rear;
        const next = (ff + fr + g.fDrag + roll) / mass;
        a = k === 0 ? next : 0.5 * (a + next);
      }
    }
    computeGrip(ctx, v, -a, kappa, null, g);
    const nextF: boolean = tireForce(car, demand.front, g.fxMaxFront, tf, slideF).sliding;
    const nextR: boolean = tireForce(car, demand.rear, g.fxMaxRear, tf, slideR).sliding;
    if (nextF === slideF && nextR === slideR) break;
    slideF = nextF;
    slideR = nextR;
  }
  return a;
}

/**
 * Full-pedal deceleration by speed for a car that started braking at `vTop` (row 12b slide state
 * carried down). A braking car meets speeds in falling order, so this sweeps the integrator's own
 * step down in speed: loads from the previous entry's deceleration (row 4's one-step lag), the
 * hysteresis rule on each axle, then the row-12 forces. The first entry is the instant the pedal
 * goes down: its loads carry `axOnset`, the driving acceleration of the step before, so an axle
 * can lock at once and (by hysteresis) stay locked. Entry `i` is at speed `min(i·SLIDE_DV, vTop)`.
 */
export function brakingSweep(
  ctx: GripContext,
  kappa: number,
  vTop: number,
  axOnset: number,
): Float64Array {
  return sweepFrom(ctx, kappa, vTop, axOnset, Infinity).decel;
}

/**
 * `brakingSweep`, stopped after `steps` entries; also returns the slide state reached (bits: 1
 * front, 2 rear), which `buildEnvelope` uses to group onset speeds that brake alike.
 */
function sweepFrom(
  ctx: GripContext,
  kappa: number,
  vTop: number,
  axOnset: number,
  steps: number,
): { decel: Float64Array; state: BrakeSlideState } {
  const { car, mass } = ctx;
  const roll = rollingForce(car);
  const demand = brakeDemand(car, 1);
  const tf: TireForceResult = { force: 0, slip: 0, sliding: false };
  const n = Math.ceil(vTop / SLIDE_DV - 1e-9);
  const decel = new Float64Array(Number.isFinite(steps) ? 0 : n + 1);
  const g = createGripState();
  let ax = axOnset;
  let slideF = false;
  let slideR = false;
  for (let i = n; i >= 0 && n - i < steps; i--) {
    computeGrip(ctx, Math.min(i * SLIDE_DV, vTop), ax, kappa, null, g);
    const fF = tireForce(car, demand.front, g.fxMaxFront, tf, slideF).force;
    slideF = tf.sliding;
    const fR = tireForce(car, demand.rear, g.fxMaxRear, tf, slideR).force;
    slideR = tf.sliding;
    const a = (fF + fR + g.fDrag + roll) / mass;
    if (decel.length > 0) decel[i] = a;
    ax = -a;
  }
  return { decel, state: (slideF ? 1 : 0) | (slideR ? 2 : 0) };
}

/** Sweep entries after which an onset's slide state is taken as settled (band grouping). */
const SETTLE_STEPS = 16;

/** Deceleration on arriving at speed `v` from above (see `brakingSweep`). */
function sweepDecelAt(decel: Float64Array, v: number): number {
  const i = Math.ceil(v / SLIDE_DV - 1e-9);
  return decel[Math.min(Math.max(i, 0), decel.length - 1)] ?? 0;
}

/**
 * The longitudinal acceleration the step before braking carries into the loads: on a straight
 * the driver comes off full throttle (traction-limited full-throttle acceleration); in a corner
 * it comes off the speed hold (0).
 */
export function onsetAx(ctx: GripContext, v: number, kappa: number, g: GripState): number {
  if (kappa !== 0) return 0;
  const { car, mass } = ctx;
  computeGrip(ctx, v, 0, 0, null, g);
  const drive = Math.min(engineForce(car, 1, v), g.fxMaxRear);
  return Math.max(0, (drive - g.fDrag - rollingForce(car)) / mass);
}

/** Row 12b slide state (bits: 1 front, 2 rear) the instant full pedal goes down at speed `v`. */
export function onsetState(
  ctx: GripContext,
  v: number,
  kappa: number,
  g: GripState = createGripState(),
): BrakeSlideState {
  const ax = onsetAx(ctx, v, kappa, g);
  computeGrip(ctx, v, ax, kappa, null, g);
  const demand = brakeDemand(ctx.car, 1);
  return (demand.front > g.fxMaxFront ? 1 : 0) | (demand.rear > g.fxMaxRear ? 2 : 0);
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

  const g = createGripState();
  let hintK = segments.length - 1;
  const kappaAt = (k: number): number => {
    hintK = segmentAt(layout, Math.min(k * ENVELOPE_DS, total), hintK);
    const seg = segments[hintK];
    return seg ? curvature(seg) : 0;
  };

  // Row 12b makes the braking depend on where it starts: at the instant the pedal goes down the
  // loads still carry the driving load transfer of the step before, so an axle can lock at once
  // and, by hysteresis, stay locked down the whole zone; whether it does depends on the onset
  // speed. So the onset speeds are split into bands (at most ONSET_DV wide, and split wherever
  // the straight-line slide state shortly after onset changes), and each band gets its own
  // backward pass, braking as a car that started at the top of the band would (`brakingSweep`).
  // Built only when the track has a braking target (a straight-only track needs none).
  const settled = (vi: number): BrakeSlideState =>
    (onsetState(ctx, vi, 0, g) << 2) |
    sweepFrom(ctx, 0, vi, onsetAx(ctx, vi, 0, g), SETTLE_STEPS).state;
  const bandLo: number[] = [];
  const bandHi: number[] = [];
  const bands = (): number => {
    if (bandLo.length > 0) return bandLo.length;
    if (!cap.some((c) => c < V_UNBOUNDED)) return 0;
    let lo = 0;
    let prev = settled(0);
    const steps = Math.ceil(vReach / SLIDE_DV - 1e-9);
    for (let i = 1; i <= steps; i++) {
      const vi = Math.min(i * SLIDE_DV, vReach);
      const c = settled(vi);
      if (c !== prev || vi - lo > ONSET_DV + 1e-9) {
        bandLo.push(lo);
        bandHi.push((i - 1) * SLIDE_DV);
        lo = (i - 1) * SLIDE_DV;
        prev = c;
      }
    }
    bandLo.push(lo);
    bandHi.push(vReach);
    return bandLo.length;
  };
  const sweeps = new Map<string, Float64Array>();
  const sweepFor = (kappa: number, j: number): Float64Array => {
    const key = `${kappa}|${j}`;
    let sweep = sweeps.get(key);
    if (!sweep) {
      const vTop = bandHi[j] ?? vReach;
      sweep = brakingSweep(ctx, kappa, vTop, onsetAx(ctx, vTop, kappa, g));
      sweeps.set(key, sweep);
    }
    return sweep;
  };

  // Curvature of the interval ending at each grid point (where the braking force acts).
  const kappas = new Float64Array(n);
  for (let k = 1; k < n; k++) kappas[k] = kappaAt(k);

  const v = new Float32Array(n).fill(V_UNBOUNDED);
  const curve = new Float64Array(n);
  for (let j = 0; j < bands(); j++) {
    const lo = bandLo[j] ?? 0;
    const top = bandHi[j] ?? vReach;
    let next = cap[n - 1] ?? V_UNBOUNDED;
    curve[n - 1] = next;
    for (let k = n - 2; k >= 0; k--) {
      let vk = cap[k] ?? V_UNBOUNDED;
      // `reach = √(next² + 2·max(a,0)·ds) ≥ next`, so when the cap is already ≤ next (inside a
      // corner held at v_lim, or on the stopped tail) the min below cannot change `vk`: skip the
      // braking-force lookup. Exact, not an approximation (Stage 5 performance work). Likewise,
      // once this band's curve is above the band it stays above it until the next cap, and only
      // speeds inside the band are read from it: mark it unbounded without the lookups.
      if (next > top && next < V_UNBOUNDED) next = V_UNBOUNDED;
      if (next < V_UNBOUNDED && vk > next) {
        const a = sweepDecelAt(sweepFor(kappas[k + 1] ?? 0, j), next);
        const reach = Math.sqrt(next * next + 2 * Math.max(a, 0) * ENVELOPE_DS);
        if (reach < vk) vk = reach;
      }
      // Speeds the car can never reach need no further braking computation.
      if (vk > vReach) vk = V_UNBOUNDED;
      curve[k] = vk;
      next = vk;
    }
    // v_env(s) is the lowest speed at which the car must brake here: in this band, any speed at
    // or above the band's curve. (With row 12b the stopping distance need not grow with the onset
    // speed, so the bands are combined by their lowest must-brake speed, never a maximum.)
    for (let k = 0; k < n; k++) {
      const ck = curve[k] ?? V_UNBOUNDED;
      if (ck > top + 1e-9) continue;
      const mustBrake = Math.max(lo, ck);
      if (mustBrake < (v[k] ?? V_UNBOUNDED)) v[k] = mustBrake;
    }
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
  /** Row 12b: the rear axle arrives sliding under drive (wheelspin carried from the last step). */
  rearSliding: boolean;
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
 * rolling resistance (plus closing any gap to `v_lim` in one step), capped by the friction circle
 * (inclusive: the demand ratio never exceeds 1). If the rear arrives sliding in a corner, the
 * driver lifts for that step (row 12b: wheelspin persists until the driver lifts).
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
  } else if (v > 0 && (v >= vEnv || (state.braking && v > vEnv - BRAKE_LATCH))) {
    // (A stopped car never needs the pedal: at a relaunch point the envelope reads 0.)
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
    if (state.rearSliding) {
      // Row 12b: wheelspin persists until the driver lifts. Holding the corner, the driver lifts
      // for one step (no demand ends a slide) and comes back on within the friction circle.
      theta = 0;
    } else {
      const target = Math.min(state.vLim, vEnv);
      const need = Math.max(0, state.resistance + (state.mass * (target - v)) / DT);
      const cap = Math.min(need, state.fxMaxRear);
      theta = Math.min(theta, cap / state.engineFull);
      // Stage 9: `(cap/F)·F` can round one ulp above `cap`, i.e. a demand ratio of 1 + 2⁻⁵² that
      // starts a slide the hysteresis then holds for the whole corner. The cap is inclusive.
      while (theta > 0 && theta * state.engineFull > cap) theta -= theta * Number.EPSILON;
    }
  }
  out.throttle = theta;
  return out;
}
