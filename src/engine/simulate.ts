/**
 * `simulate(input, mode)`: the integrator (contract 02). One step function is shared by both
 * modes; `'full'` additionally copies each step's channel values into columns.
 *
 * Each 10 ms step uses the previous step's `a_x` for load transfer (rows 4 and 13), then
 * integrates `m·dv/dt = F_x − F_brake − F_drag − crr·m·g` with semi-implicit Euler, `v ≥ 0`.
 */
import { PHYSICAL_CHANNEL_IDS } from './channels';
import { DT, G, MAX_TIME, STOP_SPEED } from './constants';
import { computeGrip, createGripContext, createGripState, gripUsed } from './corner';
import {
  buildEnvelope,
  driverInputs,
  envelopeAt,
  segmentLimitSpeeds,
  type DriverInputs,
  type DriverState,
} from './driver';
import { SimDivergedError } from './errors';
import {
  brakeDemand,
  brakeTempRate,
  engineForce,
  gearRpm,
  rollingForce,
  tireForce,
  topSpeed,
  tireTempRate,
  type AxlePair,
  type GearRpm,
  type TireForceResult,
} from './physics';
import { crossingTime, curvature, poseAt, trackLayout, type Pose } from './track';
import type { Outcome, PhysicalColumns, SimInput, SimMode, SimResult } from './types';
import { validateInput } from './validate';

const RAD_TO_DEG = 180 / Math.PI;

/** One step's channel values, keyed by physical channel id. */
type StepOut = Record<string, number>;

/** Mutable integrator state. */
interface SimState {
  step: number;
  /** s. */
  t: number;
  s: number;
  v: number;
  /** m/s², previous step's longitudinal acceleration (row 4 uses it). */
  ax: number;
  seg: number;
  /** s, time of the last launch. */
  tLaunch: number;
  braking: boolean;
  /** °C fl, fr, rl, rr. */
  tireTemp: Float64Array;
  /** °C front, rear. */
  brakeTemp: Float64Array;
}

/** Growable column store for `'full'` mode. */
class Recorder {
  private cap: number;
  n = 0;
  t: Float32Array;
  s: Float32Array;
  seg: Uint8Array;
  cols: Float32Array[];

  constructor(initial: number) {
    this.cap = initial;
    this.t = new Float32Array(initial);
    this.s = new Float32Array(initial);
    this.seg = new Uint8Array(initial);
    this.cols = PHYSICAL_CHANNEL_IDS.map(() => new Float32Array(initial));
  }

  private grow(): void {
    const cap = this.cap * 2;
    const f32 = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    this.t = f32(this.t);
    this.s = f32(this.s);
    const seg = new Uint8Array(cap);
    seg.set(this.seg);
    this.seg = seg;
    this.cols = this.cols.map(f32);
    this.cap = cap;
  }

  push(t: number, s: number, seg: number, out: StepOut): void {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    this.t[i] = t;
    this.s[i] = s;
    this.seg[i] = seg;
    for (let k = 0; k < PHYSICAL_CHANNEL_IDS.length; k++) {
      const col = this.cols[k];
      if (col) col[i] = out[PHYSICAL_CHANNEL_IDS[k] ?? ''] ?? 0;
    }
  }

  /** Copies to exact-length arrays so the run does not retain the growth slack. */
  finish(): PhysicalColumns {
    const n = this.n;
    const ch: Record<string, Float32Array> = {};
    PHYSICAL_CHANNEL_IDS.forEach((id, k) => {
      ch[id] = (this.cols[k] ?? new Float32Array(0)).slice(0, n);
    });
    return {
      n,
      dt: DT,
      t: this.t.slice(0, n),
      s: this.s.slice(0, n),
      seg: this.seg.slice(0, n),
      ch,
    };
  }
}

function stateSnapshot(st: SimState): Record<string, number> {
  return {
    t: st.t,
    s: st.s,
    v: st.v,
    ax: st.ax,
    seg: st.seg,
    tire_temp_fl: st.tireTemp[0] ?? NaN,
    tire_temp_fr: st.tireTemp[1] ?? NaN,
    tire_temp_rl: st.tireTemp[2] ?? NaN,
    tire_temp_rr: st.tireTemp[3] ?? NaN,
    brake_temp_front: st.brakeTemp[0] ?? NaN,
    brake_temp_rear: st.brakeTemp[1] ?? NaN,
  };
}

export function simulate(input: SimInput, mode: SimMode): SimResult {
  validateInput(input);
  const { car, setup, track, conditions, flags } = input;
  // `input.seed` is accepted for future in-physics noise; the meeting-cut physics has none.

  const layout = trackLayout(track);
  const nSeg = track.segments.length;
  const ctx = createGripContext(car, setup, conditions, flags);
  const mass = ctx.mass;
  const roll = rollingForce(car);
  const limits = segmentLimitSpeeds(ctx, track);
  const vTop = topSpeed(car, setup.wing);
  const env = buildEnvelope(ctx, layout, limits, 1.1 * vTop);

  const st: SimState = {
    step: 0,
    t: 0,
    s: 0,
    v: track.standingStart ? 0 : Math.min(envelopeAt(env, 0), vTop),
    ax: 0,
    seg: 0,
    // A rolling start is treated as launched long ago (full throttle available).
    tLaunch: track.standingStart ? 0 : -1e9,
    braking: false,
    tireTemp: new Float64Array(4).fill(conditions.trackTemp),
    brakeTemp: new Float64Array(2).fill(conditions.ambientTemp),
  };

  const recorder = mode === 'full' ? new Recorder(Math.max(256, Math.ceil(60 / DT))) : null;
  const out: StepOut = {};
  const grip = createGripState();
  const pose: Pose = { x: 0, y: 0, heading: 0 };
  const gr: GearRpm = { gear: 1, rpm: 0 };
  const demand: AxlePair = { front: 0, rear: 0 };
  const tfFront: TireForceResult = { force: 0, slip: 0, sliding: false };
  const tfRear: TireForceResult = { force: 0, slip: 0, sliding: false };
  const pedals: DriverInputs = { throttle: 0, brake: 0 };
  const ds: DriverState = {
    s: 0,
    v: 0,
    tSinceLaunch: 0,
    ramp: setup.throttle_ramp,
    braking: false,
    vLim: Infinity,
    stopAt: Infinity,
    mass,
    engineFull: 0,
    resistance: 0,
    fxMaxRear: 0,
  };

  const boundaryTimes: number[] = [];
  let vMax = st.v;
  let finished = false;
  const maxSteps = Math.round(MAX_TIME / DT);

  while (st.step < maxSteps) {
    const segment = track.segments[st.seg];
    if (!segment) break;
    const kappa = curvature(segment);
    const vLim = limits[st.seg] ?? Infinity;
    const v = st.v;

    // Rows 1–8, 18–20.
    computeGrip(ctx, v, st.ax, kappa, st.tireTemp, grip);

    // Driver (rows 9, 11 and the corner hold).
    const engineFull = engineForce(car, 1, v);
    ds.s = st.s;
    ds.v = v;
    ds.tSinceLaunch = st.t - st.tLaunch;
    ds.braking = st.braking;
    ds.vLim = vLim;
    ds.stopAt = segment.endsWithStop ? (layout.ends[st.seg] ?? Infinity) : Infinity;
    ds.engineFull = engineFull;
    ds.resistance = grip.fDrag + roll;
    ds.fxMaxRear = grip.fxMaxRear;
    driverInputs(ds, env, pedals);
    const beta = pedals.brake;
    const theta = pedals.throttle;

    // Rows 10–12.
    const fEng = engineForce(car, theta, v);
    let fxFront = 0;
    let fxRear = 0; // signed: + drive, − braking
    let slipFront = 0;
    let slipRear = 0;
    let slideFront = false;
    let slideRear = false;
    let fBrakeFront = 0;
    let fBrakeRear = 0;
    if (beta > 0) {
      brakeDemand(car, beta, demand);
      tireForce(car, demand.front, grip.fxMaxFront, tfFront);
      tireForce(car, demand.rear, grip.fxMaxRear, tfRear);
      fBrakeFront = tfFront.force;
      fBrakeRear = tfRear.force;
      fxFront = -fBrakeFront;
      fxRear = -fBrakeRear;
      slipFront = tfFront.slip;
      slipRear = tfRear.slip;
      slideFront = tfFront.sliding;
      slideRear = tfRear.sliding;
    } else {
      tireForce(car, fEng, grip.fxMaxRear, tfRear);
      fxRear = tfRear.force;
      slipRear = tfRear.slip;
      slideRear = tfRear.sliding;
    }

    // Row 13: semi-implicit Euler, v ≥ 0.
    const fNet = fxRear + fxFront - grip.fDrag - roll;
    const a = fNet / mass;
    // v ≥ 0: brakes and rolling resistance cannot push a stopped car backwards.
    const vNew = Math.max(0, v + a * DT);
    const sNew = st.s + vNew * DT;
    const axNew = (vNew - v) / DT;

    // Rows 15–16: temperatures (explicit Euler from the current state).
    const loadFront = grip.nFL + grip.nFR;
    const loadRear = grip.nRL + grip.nRR;
    const usedFront = gripUsed(fxFront, grip.fyFront, grip.budgetFront);
    const usedRear = gripUsed(fxRear, grip.fyRear, grip.budgetRear);
    const heatFront = flags.tractionLimit
      ? usedFront
      : Math.hypot(fxFront, grip.fyFront) / (car.muPeak * loadFront);
    const heatRear = flags.tractionLimit
      ? usedRear
      : Math.hypot(fxRear, grip.fyRear) / (car.muPeak * loadRear);
    const tt = st.tireTemp;
    const tFL = tt[0] ?? 0;
    const tFR = tt[1] ?? 0;
    const tRL = tt[2] ?? 0;
    const tRR = tt[3] ?? 0;
    const bF = st.brakeTemp[0] ?? 0;
    const bR = st.brakeTemp[1] ?? 0;

    // Row 14: wheel speeds.
    const wFront = beta > 0 ? v * (1 - slipFront) : v;
    const wRear = beta > 0 ? v * (1 - slipRear) : v * (1 + slipRear);

    // Channel values for this step (state at the start of the step + the forces it applied).
    if (recorder) {
      poseAt(layout, st.s, pose, st.seg);
      gearRpm(v, gr);
      out.speed = v;
      out.long_g = axNew / G;
      out.drag_force = grip.fDrag;
      out.downforce = grip.fDown;
      out.engine_force = fEng;
      out.throttle = theta;
      out.brake = beta;
      out.engine_rpm = gr.rpm;
      out.gear = gr.gear;
      out.load_fl = grip.nFL;
      out.load_fr = grip.nFR;
      out.load_rl = grip.nRL;
      out.load_rr = grip.nRR;
      out.load_front = loadFront;
      out.load_rear = loadRear;
      const sign = kappa > 0 ? 1 : kappa < 0 ? -1 : 0;
      out.lat_g = (sign * grip.ay) / G;
      out.steering_angle = car.wheelbase * kappa * RAD_TO_DEG;
      out.yaw_rate = v * kappa * RAD_TO_DEG;
      out.heading = pose.heading * RAD_TO_DEG;
      out.pos_x = pose.x;
      out.pos_y = pose.y;
      out.grip_budget_front = grip.budgetFront;
      out.grip_budget_rear = grip.budgetRear;
      out.grip_used_front = usedFront;
      out.grip_used_rear = usedRear;
      out.front_slip_ratio = slipFront;
      out.rear_slip_ratio = slipRear;
      out.wheel_speed_fl = wFront;
      out.wheel_speed_fr = wFront;
      out.wheel_speed_rl = wRear;
      out.wheel_speed_rr = wRear;
      out.tire_temp_fl = tFL;
      out.tire_temp_fr = tFR;
      out.tire_temp_rl = tRL;
      out.tire_temp_rr = tRR;
      out.brake_temp_front = bF;
      out.brake_temp_rear = bR;
      out.mu_front = 0.5 * (grip.muFL + grip.muFR);
      out.mu_rear = 0.5 * (grip.muRL + grip.muRR);
      out.rolling_force = roll;
      out.power_used = fEng * v;
      out.corner_limit_speed = Number.isFinite(vLim) ? vLim : 0;
      recorder.push(st.t, st.s, st.seg, out);
    }

    // Advance the state.
    const tr = conditions.trackTemp;
    tt[0] = tFL + DT * tireTempRate(tFL, heatFront, v, slideFront, tr);
    tt[1] = tFR + DT * tireTempRate(tFR, heatFront, v, slideFront, tr);
    tt[2] = tRL + DT * tireTempRate(tRL, heatRear, v, slideRear, tr);
    tt[3] = tRR + DT * tireTempRate(tRR, heatRear, v, slideRear, tr);
    st.brakeTemp[0] = bF + DT * brakeTempRate(bF, fBrakeFront, v, conditions.ambientTemp);
    st.brakeTemp[1] = bR + DT * brakeTempRate(bR, fBrakeRear, v, conditions.ambientTemp);

    const t0 = st.t;
    const s0 = st.s;
    st.step++;
    st.t = st.step * DT;
    st.v = vNew;
    st.s = sNew;
    st.ax = axNew;
    st.braking = beta > 0;

    if (
      !Number.isFinite(vNew) ||
      !Number.isFinite(sNew) ||
      !Number.isFinite(axNew) ||
      !Number.isFinite(tt[0] ?? NaN) ||
      !Number.isFinite(tt[2] ?? NaN) ||
      !Number.isFinite(st.brakeTemp[0] ?? NaN)
    ) {
      throw new SimDivergedError(st.step - 1, stateSnapshot(st));
    }
    if (vNew > vMax) vMax = vNew;

    // Segment ends: a stop, or crossing the cumulative boundary.
    if (segment.endsWithStop) {
      if (beta > 0 && vNew < STOP_SPEED) {
        // The instant v falls through STOP_SPEED, interpolated within the step (v is linear in t).
        const drop = v - (v + a * DT);
        const f = drop > 0 ? Math.min(1, Math.max(0, (v - STOP_SPEED) / drop)) : 1;
        st.v = 0;
        st.ax = 0;
        st.braking = false;
        boundaryTimes.push(t0 + f * DT);
        st.seg++;
        st.tLaunch = st.t;
        if (st.seg >= nSeg) {
          finished = true;
          break;
        }
      }
    } else {
      while (st.seg < nSeg) {
        const cur = track.segments[st.seg];
        const end = layout.ends[st.seg] ?? Infinity;
        if (!cur || cur.endsWithStop || sNew < end) break;
        boundaryTimes.push(crossingTime(t0, DT, s0, sNew, end));
        st.seg++;
      }
      if (st.seg >= nSeg) {
        finished = true;
        break;
      }
    }
  }

  const outcome: Outcome = finished
    ? {
        totalTime: boundaryTimes[boundaryTimes.length - 1] ?? 0,
        segmentTimes: boundaryTimes.map(
          (tb, i) => tb - (i === 0 ? 0 : (boundaryTimes[i - 1] ?? 0)),
        ),
        topSpeed: vMax,
        finished: true,
      }
    : {
        totalTime: Infinity,
        segmentTimes: track.segments.map((_, i) =>
          i < boundaryTimes.length
            ? (boundaryTimes[i] ?? 0) - (i === 0 ? 0 : (boundaryTimes[i - 1] ?? 0))
            : Infinity,
        ),
        topSpeed: vMax,
        finished: false,
      };

  const result: SimResult = { outcome };
  if (recorder) result.columns = recorder.finish();
  return result;
}
