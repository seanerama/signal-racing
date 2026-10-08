/**
 * The default car (contract 01 comment values, spec "Default car" table). Round numbers in the
 * neighbourhood of an IndyCar, labelled approximate. Stage 2 may tune the values (never the
 * equations) to make the A1–A4 lessons fall out of the model; every change is recorded in the
 * Stage 2 report and mirrored into the contract 01 comments.
 */
import type { CarParams } from './types';

/*
 * Stage 2 value changes from the contract 01 / spec table (equations unchanged):
 * - fPeak 10_000 → 6_150 N. With 10 kN the rear (μ·N_r ≈ 6.3 kN at d = 0.45 even with full
 *   load transfer) spins for seconds whatever the ramp, so A2's ramp has nothing to teach. At
 *   6.15 kN a stab of throttle spins the rears (standstill budget ≈ 5.35 kN) and stays stuck in
 *   the spin, while a short ramp lets load transfer build first and the car never spins.
 * - brakeBiasFront 0.55 → 0.60 and brakeForceMax 16_000 → 13_000 N. With 55 % front and 16 kN
 *   (2.2 g, above μ·g) both axles lock at low speed for every weight distribution and the rear
 *   locks first, so braking also wants more rear weight and A3 has no interior optimum. With
 *   these values the front axle is the braking limit, so rear weight helps the launch and costs
 *   the stop (front lock), as the spec's A3 describes.
 */
export const DEFAULT_CAR: Readonly<CarParams> = Object.freeze({
  mass: 750,
  power: 500_000,
  fPeak: 6_150,
  cd0A: 0.68,
  kdA: 0.02,
  cl0A: 1.4,
  klA: 0.4,
  aeroBalanceRear: 0.55,
  muPeak: 1.6,
  kLoadSens: 0.1,
  cogHeight: 0.3,
  wheelbase: 3.0,
  trackWidth: 1.9,
  crr: 0.015,
  brakeForceMax: 13_000,
  brakeBiasFront: 0.6,
  pOpt: 1.65,
  sigmaP: 0.9,
  tOpt: 90,
  sigmaT: 25,
  sPeak: 0.1,
  kSlide: 0.5,
  slideFactor: 0.8,
  fuelMass0: 0,
  arbFrontShare: 0.5,
});
