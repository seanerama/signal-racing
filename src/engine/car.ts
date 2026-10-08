/**
 * The default car (contract 01 comment values, spec "Default car" table). Round numbers in the
 * neighbourhood of an IndyCar, labelled approximate. Stage 2 may tune the values (never the
 * equations) to make the A1–A4 lessons fall out of the model; every change is recorded in the
 * Stage 2 report and mirrored into the contract 01 comments.
 */
import type { CarParams } from './types';

/*
 * Stage 2 value changes from the contract 01 / spec table (equations unchanged):
 * - fPeak 10_000 → 5_800 N (Stage 2 had 6_150; Stage 2b, Vision Lead approved 2026-10-08).
 *   With slide hysteresis (row 12b, kRegrip) a spin, once started, lasts until the budget grows
 *   past demand/kRegrip, i.e. tens of m/s later whatever the ramp. So a ramp only pays if it
 *   avoids the spin altogether, and it must be short (each second of ramp costs ≈ 0.5 s, about
 *   what a spin costs). Load transfer, not downforce, is what a short ramp waits for, so the A2
 *   ramp optimum is interior exactly for
 *     μ·d·m·g  <  fPeak  <  μ·d·m·g / (1 − μ·h/L)   ≈ 5.35 … 6.25 kN at d = 0.45, p = pOpt:
 *   above the standstill budget (a stab of throttle spins on the first step, before any load
 *   has transferred) and below the fully transferred budget (a short ramp never spins).
 *   5.8 kN sits mid-window, so the lesson survives ±5% in fPeak (tested over 5.5–6.1 kN).
 *   On the 0–3.0 s (step 0.2) lever the optimum is the shortest non-zero ramp, 0.2 s: ramp 0
 *   spins (+0.33 s), every longer ramp only adds time (≈ +0.1 s per 0.2 s); spread 7.5%.
 *   Pressure: grip beyond the no-spin need buys nothing, so p = 1.5–1.8 bar tie (plateau).
 *   With 10 kN every ramp in 0–3 s spins and the ramp optimum is 0: placing the window there
 *   would need μ ≈ 2.6 or a ~1200 kg car, outside the spec table.
 * - kRegrip 0.85 (new field, contract 02 row 12b): a sliding axle regrips below 85 % of its budget.
 * - brakeBiasFront 0.55 → 0.60 and brakeForceMax 16_000 → 13_000 N. With 55 % front and 16 kN
 *   (2.2 g, above μ·g) both axles lock at low speed for every weight distribution and the rear
 *   locks first, so braking also wants more rear weight and A3 has no interior optimum. With
 *   these values the front axle is the braking limit, so rear weight helps the launch and costs
 *   the stop (front lock), as the spec's A3 describes.
 */
export const DEFAULT_CAR: Readonly<CarParams> = Object.freeze({
  mass: 750,
  power: 500_000,
  fPeak: 5_800,
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
  kRegrip: 0.85,
  fuelMass0: 0,
  arbFrontShare: 0.5,
});
