/**
 * The physics model, one pure function per row of the contract 02 table (rows 1–17 here; the
 * corner rows 18–22 live in `corner.ts`). Every function quotes its equation. SI throughout.
 *
 * Functions that produce two values write into a caller-owned `out` object so the integrator
 * allocates nothing per step; `out` defaults to a fresh object for convenience in tests.
 */
import {
  G,
  GEAR_BAND,
  GEARS,
  K_BRAKE,
  K_BRAKE_COOL,
  K_COOL,
  K_HEAT,
  RHO,
  RPM_BASE,
  RPM_SPAN,
  SLIDE_HEAT_MULT,
  V_ENGINE_MIN,
} from './constants';
import type { CarParams, ModelFlags } from './types';

/** A front/rear pair (N unless stated). */
export interface AxlePair {
  front: number;
  rear: number;
}

/** Aerodynamic areas (m²). */
export interface AeroCoeffs {
  cdA: number;
  clA: number;
}

/** Result of the tire force model for one axle (row 12). */
export interface TireForceResult {
  /** N, force actually delivered. */
  force: number;
  /** Slip ratio, 0..1. */
  slip: number;
  /** True when the demand exceeds the budget (`r > 1`). */
  sliding: boolean;
}

/** Total car mass in kg: `m = mass + fuelMass0`. */
export function carMass(car: CarParams): number {
  return car.mass + car.fuelMass0;
}

/** Row 1: `CdA = cd0A + kdA·w²`, `ClA = cl0A + klA·w`. */
export function aeroCoeffs(
  car: CarParams,
  wing: number,
  out: AeroCoeffs = { cdA: 0, clA: 0 },
): AeroCoeffs {
  out.cdA = car.cd0A + car.kdA * wing * wing;
  out.clA = car.cl0A + car.klA * wing;
  return out;
}

/** Row 2: `F_drag = ½ρ·CdA·v²`. */
export function dragForce(cdA: number, v: number): number {
  return 0.5 * RHO * cdA * v * v;
}

/** Row 2: `F_down = ½ρ·ClA·v²`. */
export function downforce(clA: number, v: number): number {
  return 0.5 * RHO * clA * v * v;
}

/** Rolling resistance: `F_roll = crr·m·g` (the last term of row 13). */
export function rollingForce(car: CarParams): number {
  return car.crr * carMass(car) * G;
}

/** Row 3: `N_f = (1−d)·m·g + (1−b)·F_down`, `N_r = d·m·g + b·F_down`. */
export function staticLoads(
  car: CarParams,
  weightDist: number,
  fDown: number,
  out: AxlePair = { front: 0, rear: 0 },
): AxlePair {
  const mg = carMass(car) * G;
  const b = car.aeroBalanceRear;
  out.front = (1 - weightDist) * mg + (1 - b) * fDown;
  out.rear = weightDist * mg + b * fDown;
  return out;
}

/**
 * Row 4: `ΔN = m·a_x·h/L`; `N_r += ΔN`, `N_f −= ΔN`; each clamped ≥ 0.
 * The clamp limits ΔN itself to `[−N_r, N_f]`, so the axle that would go negative ends at 0 and
 * the total load is conserved (guarantee 5).
 */
export function transferLoads(
  car: CarParams,
  front: number,
  rear: number,
  ax: number,
  out: AxlePair = { front: 0, rear: 0 },
): AxlePair {
  let dN = (carMass(car) * ax * car.cogHeight) / car.wheelbase;
  if (dN > front) dN = front;
  if (dN < -rear) dN = -rear;
  out.front = front - dN;
  out.rear = rear + dN;
  return out;
}

/** Row 5: `μ_p = exp(−((p − pOpt)/sigmaP)²)` if `pressureAffectsGrip`, else 1. */
export function pressureFactor(car: CarParams, pressure: number, flags: ModelFlags): number {
  if (!flags.pressureAffectsGrip) return 1;
  const x = (pressure - car.pOpt) / car.sigmaP;
  return Math.exp(-x * x);
}

/** Row 6: `μ_T = exp(−((T − tOpt)/sigmaT)²)` if `tempAffectsGrip`, else 1. */
export function tempFactor(car: CarParams, temp: number, flags: ModelFlags): number {
  if (!flags.tempAffectsGrip) return 1;
  const x = (temp - car.tOpt) / car.sigmaT;
  return Math.exp(-x * x);
}

/**
 * Row 7: `μ_i = muPeak·μ_p·μ_T·gripMultiplier·(1 − kLoadSens·(N_i − N_ref)/N_ref)`, `N_ref = m·g/4`.
 * `muBase` is the product `muPeak·μ_p·μ_T·gripMultiplier`.
 */
export function tireMu(car: CarParams, muBase: number, load: number): number {
  const nRef = (carMass(car) * G) / 4;
  return muBase * (1 - (car.kLoadSens * (load - nRef)) / nRef);
}

/** Row 8: `F_max,axle = Σ_{i∈axle} μ_i·N_i` (infinite if `!tractionLimit`). */
export function axleBudget(
  muA: number,
  loadA: number,
  muB: number,
  loadB: number,
  flags: ModelFlags,
): number {
  if (!flags.tractionLimit) return Infinity;
  return muA * loadA + muB * loadB;
}

/** Row 9: `θ(t) = t_ramp == 0 ? 1 : min(1, t/t_ramp)`, t since launch; 0 while braking. */
export function throttle(tSinceLaunch: number, ramp: number, braking: boolean): number {
  if (braking) return 0;
  if (ramp === 0) return 1;
  return Math.min(1, Math.max(0, tSinceLaunch) / ramp);
}

/** Row 10: `F_eng = θ·min(fPeak, P/max(v, 0.5))` (rear-wheel drive). */
export function engineForce(car: CarParams, theta: number, v: number): number {
  return theta * Math.min(car.fPeak, car.power / Math.max(v, V_ENGINE_MIN));
}

/**
 * Row 11: `F_bf = brakeBiasFront·β·brakeForceMax`, `F_br = (1 − brakeBiasFront)·β·brakeForceMax`,
 * β ∈ {0,1} (`brakeBiasFront` 0.60, fixed in the meeting cut).
 */
export function brakeDemand(
  car: CarParams,
  beta: number,
  out: AxlePair = { front: 0, rear: 0 },
): AxlePair {
  out.front = car.brakeBiasFront * beta * car.brakeForceMax;
  out.rear = (1 - car.brakeBiasFront) * beta * car.brakeForceMax;
  return out;
}

/**
 * Row 12: `r = F_demand/F_max`. If `r ≤ 1`: `F = F_demand`, `slip = sPeak·r`.
 * If `r > 1` (sliding): `F = slideFactor·F_max`.
 *
 * Row 12b (slide hysteresis): the axle's `sliding` state becomes true when `r > 1` and stays true
 * until `r < kRegrip`. While sliding, `F = slideFactor·F_max` and
 * `slip = min(1, sPeak + kSlide·max(0, r − kRegrip))`. `wasSliding` is the axle's state from the
 * previous step (false for a fresh axle); no demand (`F_demand ≤ 0`) ends a slide.
 */
export function tireForce(
  car: CarParams,
  demand: number,
  fMax: number,
  out: TireForceResult = { force: 0, slip: 0, sliding: false },
  wasSliding = false,
): TireForceResult {
  if (demand <= 0) {
    out.force = 0;
    out.slip = 0;
    out.sliding = false;
    return out;
  }
  const r = fMax > 0 ? demand / fMax : Infinity;
  const sliding = wasSliding ? r >= car.kRegrip : r > 1;
  if (!sliding) {
    out.force = demand;
    out.slip = car.sPeak * r;
    out.sliding = false;
  } else {
    out.force = fMax > 0 ? car.slideFactor * fMax : 0;
    out.slip = Math.min(1, car.sPeak + car.kSlide * Math.max(0, r - car.kRegrip));
    out.sliding = true;
  }
  return out;
}

/**
 * Row 15: `dT/dt = kHeat·(F_used/F_max)²·v − kCool·(T − T_track)`, `kHeat = 0.9`, `kCool = 0.02`;
 * sliding multiplies heat in by 4. `usedRatio` is `F_used/F_max` (or `F_used/(μ_peak·N)` when the
 * traction limit is off; the caller decides).
 */
export function tireTempRate(
  temp: number,
  usedRatio: number,
  v: number,
  sliding: boolean,
  trackTemp: number,
): number {
  const heatIn = K_HEAT * usedRatio * usedRatio * v * (sliding ? SLIDE_HEAT_MULT : 1);
  return heatIn - K_COOL * (temp - trackTemp);
}

/** Row 16: `dT/dt = kBrake·F_brake·v − kBrakeCool·(T − T_amb)`, `kBrake = 2e-6`, `kBrakeCool = 0.05`. */
export function brakeTempRate(
  temp: number,
  fBrake: number,
  v: number,
  ambientTemp: number,
): number {
  return K_BRAKE * fBrake * v - K_BRAKE_COOL * (temp - ambientTemp);
}

/** Gear and engine speed (row 17). */
export interface GearRpm {
  gear: number;
  rpm: number;
}

/**
 * Row 17 (correlated, no physics effect): `gear = 1 + floor(min(5, v/15))`;
 * `rpm = 4000 + (v − 15·(gear−1))/15·8000` (sawtooth).
 */
export function gearRpm(v: number, out: GearRpm = { gear: 1, rpm: RPM_BASE }): GearRpm {
  const gear = 1 + Math.floor(Math.min(GEARS - 1, v / GEAR_BAND));
  out.gear = gear;
  out.rpm = RPM_BASE + ((v - GEAR_BAND * (gear - 1)) / GEAR_BAND) * RPM_SPAN;
  return out;
}

/** Power-limited top speed: the root of `P = ½ρCdA·v³ + crr·m·g·v` (guarantee 4), by bisection. */
export function powerLimitedTopSpeed(car: CarParams, wing: number): number {
  const { cdA } = aeroCoeffs(car, wing);
  const roll = rollingForce(car);
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (dragForce(cdA, mid) * mid + roll * mid < car.power) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Full-throttle top speed: the root of `min(fPeak, P/v) = ½ρCdA·v² + crr·m·g`. Equals the
 * power-limited speed unless drag already balances `fPeak` below `P/fPeak` (high wing).
 * Used for rolling starts and to bound the braking envelope.
 */
export function topSpeed(car: CarParams, wing: number): number {
  const { cdA } = aeroCoeffs(car, wing);
  const roll = rollingForce(car);
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (engineForce(car, 1, mid) > dragForce(cdA, mid) + roll) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}
