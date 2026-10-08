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
 *
 * Stage 11 value changes (Fable spirit review; equations unchanged):
 * - pOpt 1.65 → 1.7 bar and sigmaP 0.9 → 0.4 bar. With σ_p = 0.9 the rears carried a no-ramp-spin
 *   launch at every pressure from 1.5 to 1.8 bar, so A2 timed 18.610 s at all four (a flat
 *   plateau) and the grid broke the tie to 1.5 while the Model page said 1.65. With 0.4 bar the
 *   bell is visible in time: at the best ramp 1.6/1.8 bar are 2.2 % slower than 1.7 (the rears
 *   need a longer ramp or spin), 1.5/1.9 another 9 %; pOpt sits on the 0.1 bar lever grid, so the
 *   debrief, the Model page and the hint name the same optimum.
 * - brakeBiasFront 0.60 → 0.70 and brakeForceMax 13_000 → 11_500 N. With a fixed bias b the
 *   front axle reaches its limit before the rear only when the static rear share d exceeds
 *   d* = 1 − b + μ·h/L (equal axle demands over grips, static loads, no aero). At 60 % front
 *   d* = 1 − 0.60 + 1.6·0.1 = 0.56, above the whole 0.38–0.52 weight lever: the rears locked for
 *   2.0–2.9 s of every A3 stop at every weight, and braking time hardly moved with weight
 *   (4.65–4.77 s), so the stop side of the A3 tradeoff never bit. At 70 % front d* = 0.46, inside
 *   the lever: below it the rears lock in the stop, above it the fronts do, and at the A3
 *   optimum (wd 0.44) neither axle slides. 11.5 kN (1.56 g) puts the front-lock onset at
 *   wd 0.46 on A3.
 * - aeroBalanceRear 0.55 → 0.48. In a corner each axle's lateral demand follows its static
 *   share (d rear) while its grip follows static load plus its share of downforce, so the axles
 *   balance near d = aeroBalanceRear. At 0.55 that was above the weight lever: more rear weight
 *   was always faster on every corner level (A4, B1L, B4L monotone to wd 0.52). At 0.48 the
 *   corner balance sits inside the lever, so rear weight trades launch traction against corner
 *   balance and front braking, which is the join levels' lesson. (0.45 balanced lower still, but
 *   at the guarantee-8 setup, wd 0.45, the rear then limited the corner and could not also carry
 *   the drive that holds speed against drag: the hold sagged 0.8–1.6 % below the row-21 limit.)
 */
export const DEFAULT_CAR: Readonly<CarParams> = Object.freeze({
  mass: 750,
  power: 500_000,
  fPeak: 5_800,
  cd0A: 0.68,
  kdA: 0.02,
  cl0A: 1.4,
  klA: 0.4,
  aeroBalanceRear: 0.48,
  muPeak: 1.6,
  kLoadSens: 0.1,
  cogHeight: 0.3,
  wheelbase: 3.0,
  trackWidth: 1.9,
  crr: 0.015,
  brakeForceMax: 11_500,
  brakeBiasFront: 0.7,
  pOpt: 1.7,
  sigmaP: 0.4,
  tOpt: 90,
  sigmaT: 25,
  sPeak: 0.1,
  kSlide: 0.5,
  slideFactor: 0.8,
  kRegrip: 0.85,
  fuelMass0: 0,
  arbFrontShare: 0.5,
});
