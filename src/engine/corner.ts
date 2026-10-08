/**
 * Grip assembly for one instant (rows 1–8 combined with the corner rows 18–20), the corner
 * limit speed (row 21) and grip used (row 22).
 *
 * `computeGrip` is the single place where loads, μ and budgets are put together. The integrator,
 * the braking envelope and `cornerLimitSpeed` all call it, so the driver's targets come from
 * exactly the physics the car experiences.
 */
import { CORNER_TOL, CORNER_V_MAX } from './constants';
import {
  aeroCoeffs,
  axleBudget,
  carMass,
  downforce,
  dragForce,
  pressureFactor,
  staticLoads,
  tempFactor,
  tireMu,
  transferLoads,
  type AeroCoeffs,
  type AxlePair,
} from './physics';
import type { CarParams, Conditions, ModelFlags, Setup } from './types';

/** Per-run constants of the grip model. */
export interface GripContext {
  car: CarParams;
  flags: ModelFlags;
  /** kg. */
  mass: number;
  /** Rear weight fraction d. */
  weightDist: number;
  /** ARB front share q. */
  arbFront: number;
  /** m². */
  aero: AeroCoeffs;
  /** `muPeak·μ_p·gripMultiplier` (μ_T is applied per tire). */
  muBase: number;
}

/** Everything `computeGrip` produces. Tire order: fl, fr, rl, rr. */
export interface GripState {
  fDrag: number;
  fDown: number;
  /** m/s², lateral acceleration magnitude `v²/r` (row 18). */
  ay: number;
  /** N, lateral force demand per axle (row 18). */
  fyFront: number;
  fyRear: number;
  /** N, tire loads. */
  nFL: number;
  nFR: number;
  nRL: number;
  nRR: number;
  /** Per-tire μ_i (row 7). */
  muFL: number;
  muFR: number;
  muRL: number;
  muRR: number;
  /** N, `Σ μ_i·N_i` per axle, always finite (what the channels show). */
  budgetFront: number;
  budgetRear: number;
  /** N, enforced budget per axle (row 8: infinite when `!tractionLimit`). */
  fMaxFront: number;
  fMaxRear: number;
  /** N, longitudinal force available after the lateral demand (row 20). */
  fxMaxFront: number;
  fxMaxRear: number;
  /** Working space for `computeGrip` (no allocation per step). */
  scratch: { stat: AxlePair; long: AxlePair; lat: AxlePair; demand: AxlePair };
}

export function createGripState(): GripState {
  return {
    fDrag: 0,
    fDown: 0,
    ay: 0,
    fyFront: 0,
    fyRear: 0,
    nFL: 0,
    nFR: 0,
    nRL: 0,
    nRR: 0,
    muFL: 0,
    muFR: 0,
    muRL: 0,
    muRR: 0,
    budgetFront: 0,
    budgetRear: 0,
    fMaxFront: 0,
    fMaxRear: 0,
    fxMaxFront: 0,
    fxMaxRear: 0,
    scratch: {
      stat: { front: 0, rear: 0 },
      long: { front: 0, rear: 0 },
      lat: { front: 0, rear: 0 },
      demand: { front: 0, rear: 0 },
    },
  };
}

export function createGripContext(
  car: CarParams,
  setup: Setup,
  conditions: Conditions,
  flags: ModelFlags,
): GripContext {
  return {
    car,
    flags,
    mass: carMass(car),
    weightDist: setup.weight_dist,
    arbFront: car.arbFrontShare,
    aero: aeroCoeffs(car, setup.wing),
    muBase:
      car.muPeak * pressureFactor(car, setup.tire_pressure, flags) * conditions.gripMultiplier,
  };
}

/** Row 18: `a_y = v²/r`; `F_y,f = m·a_y·(1−d)`, `F_y,r = m·a_y·d`. */
export function lateralDemand(
  mass: number,
  weightDist: number,
  v: number,
  radius: number,
  out: AxlePair = { front: 0, rear: 0 },
): AxlePair {
  const ay = radius > 0 && Number.isFinite(radius) ? (v * v) / radius : 0;
  out.front = mass * ay * (1 - weightDist);
  out.rear = mass * ay * weightDist;
  return out;
}

/**
 * Row 19: `ΔN_lat = m·a_y·h/t`; front axle takes `q·ΔN_lat`, rear `(1−q)·ΔN_lat`.
 * Returns the per-axle transfer (added to the outside tire, taken from the inside tire).
 */
export function lateralTransfer(
  car: CarParams,
  mass: number,
  ay: number,
  q: number,
  out: AxlePair = { front: 0, rear: 0 },
): AxlePair {
  const dN = (mass * ay * car.cogHeight) / car.trackWidth;
  out.front = q * dN;
  out.rear = (1 - q) * dN;
  return out;
}

/** Row 20: `F_x,max = √(F_max² − F_y²)` (0 when the lateral demand alone exceeds the budget). */
export function frictionCircle(fMax: number, fy: number): number {
  if (!Number.isFinite(fMax)) return Infinity;
  const rem = fMax * fMax - fy * fy;
  return rem > 0 ? Math.sqrt(rem) : 0;
}

/** Row 22: `grip_used_axle = √(F_x² + F_y²)/F_max,axle`. */
export function gripUsed(fx: number, fy: number, fMax: number): number {
  if (!(fMax > 0)) return fx === 0 && fy === 0 ? 0 : Infinity;
  return Math.sqrt(fx * fx + fy * fy) / fMax;
}

/**
 * Loads, μ and budgets at speed `v` with previous-step longitudinal acceleration `ax`, on a path
 * of signed curvature `kappa` (1/m, + = left). `temps` (fl, fr, rl, rr in °C) feeds μ_T; pass
 * `null` to assume tires at `tOpt` (the driver's planning model).
 * Results depend only on the arguments; `out.scratch` is working space, overwritten per call.
 */
export function computeGrip(
  ctx: GripContext,
  v: number,
  ax: number,
  kappa: number,
  temps: ArrayLike<number> | null,
  out: GripState,
): GripState {
  const { car, flags, mass } = ctx;
  const {
    stat: scratchStatic,
    long: scratchLong,
    lat: scratchLat,
    demand: scratchDemand,
  } = out.scratch;
  out.fDrag = dragForce(ctx.aero.cdA, v);
  out.fDown = downforce(ctx.aero.clA, v);

  // Rows 3–4: static + longitudinal transfer.
  staticLoads(car, ctx.weightDist, out.fDown, scratchStatic);
  transferLoads(car, scratchStatic.front, scratchStatic.rear, ax, scratchLong);
  const nF = scratchLong.front;
  const nR = scratchLong.rear;

  // Rows 18–19: lateral demand and transfer.
  const radius = kappa === 0 ? Infinity : 1 / Math.abs(kappa);
  lateralDemand(mass, ctx.weightDist, v, radius, scratchDemand);
  out.ay = kappa === 0 ? 0 : v * v * Math.abs(kappa);
  out.fyFront = scratchDemand.front;
  out.fyRear = scratchDemand.rear;
  lateralTransfer(car, mass, out.ay, ctx.arbFront, scratchLat);
  const dF = Math.min(scratchLat.front, nF / 2);
  const dR = Math.min(scratchLat.rear, nR / 2);
  // Outside tire gains, inside tire loses. Left turn → outside is the right side.
  const sideF = kappa > 0 ? -dF : dF; // added to the left tire
  const sideR = kappa > 0 ? -dR : dR;
  out.nFL = nF / 2 + sideF;
  out.nFR = nF / 2 - sideF;
  out.nRL = nR / 2 + sideR;
  out.nRR = nR / 2 - sideR;

  // Rows 6–7: μ per tire.
  const b = ctx.muBase;
  out.muFL = tireMu(car, b * (temps ? tempFactor(car, temps[0] ?? car.tOpt, flags) : 1), out.nFL);
  out.muFR = tireMu(car, b * (temps ? tempFactor(car, temps[1] ?? car.tOpt, flags) : 1), out.nFR);
  out.muRL = tireMu(car, b * (temps ? tempFactor(car, temps[2] ?? car.tOpt, flags) : 1), out.nRL);
  out.muRR = tireMu(car, b * (temps ? tempFactor(car, temps[3] ?? car.tOpt, flags) : 1), out.nRR);

  // Row 8: budgets. Row 20: what remains for longitudinal force.
  out.budgetFront = out.muFL * out.nFL + out.muFR * out.nFR;
  out.budgetRear = out.muRL * out.nRL + out.muRR * out.nRR;
  out.fMaxFront = axleBudget(out.muFL, out.nFL, out.muFR, out.nFR, flags);
  out.fMaxRear = axleBudget(out.muRL, out.nRL, out.muRR, out.nRR, flags);
  out.fxMaxFront = frictionCircle(out.fMaxFront, out.fyFront);
  out.fxMaxRear = frictionCircle(out.fMaxRear, out.fyRear);
  return out;
}

/**
 * Row 21: the largest `v` with `F_y,f ≤ F_max,f` and `F_y,r ≤ F_max,r` (downforce and load
 * sensitivity included, steady state `a_x = 0`, tires at `tOpt`) by bisection, tolerance
 * 0.01 m/s. Returns the feasible end of the bracket; `CORNER_V_MAX` (200 m/s) if grip never limits.
 */
export function cornerLimitSpeed(
  car: CarParams,
  setup: Setup,
  cond: Conditions,
  flags: ModelFlags,
  radius: number,
): number {
  return cornerLimitSpeedCtx(createGripContext(car, setup, cond, flags), radius);
}

/** `cornerLimitSpeed` on a prepared context. */
export function cornerLimitSpeedCtx(ctx: GripContext, radius: number): number {
  const g = createGripState();
  const kappa = 1 / radius;
  const feasible = (v: number): boolean => {
    computeGrip(ctx, v, 0, kappa, null, g);
    return g.fyFront <= g.fMaxFront && g.fyRear <= g.fMaxRear;
  };
  if (feasible(CORNER_V_MAX)) return CORNER_V_MAX;
  let lo = 0;
  let hi = CORNER_V_MAX;
  while (hi - lo > CORNER_TOL) {
    const mid = 0.5 * (lo + hi);
    if (feasible(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
