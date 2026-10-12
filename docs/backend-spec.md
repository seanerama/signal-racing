# Signal — Model and Backend Spec (as built)

Documents the game as implemented at v0.4.1: the physics, the driver, the telemetry pipeline, the
hint and assist math, the target search, the scoring and progression rules, and the contracts
between them. It is written from the code (`src/engine`, `src/telemetry`, `src/levels`,
`src/hints`, `src/assist`, `src/game`, `src/worker`, `src/export`, `src/persist`, `src/units`) and
is meant to be the fixed ground on which the game flow and UI are redesigned.

**Out of scope on purpose:** the current screens, the report (strip stack, channel table, cursor,
track view, grip circle, playback), the debrief and model pages, the response surface and
waterfall renderers, styling, keyboard bindings, and routing. Those are being reworked. Where
this document mentions "the UI" it means whatever consumes the contracts in §13.

`signal.md` remains the original design spec. §14 lists where the build departs from it.

---

## 1. Architecture

### 1.1 Layers and boundaries

| Layer                  | Directory                                | Imports allowed                         | Role                                                                                 |
| ---------------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| Engine                 | `src/engine`                             | only `src/engine`                       | Pure physics, driver, track geometry, RNG. No I/O, no `Date`, no `Math.random`.      |
| Telemetry              | `src/telemetry`                          | engine                                  | Channel registry, noise layer, derived channels, distractor generators, run summary. |
| Levels                 | `src/levels`                             | engine, hints, telemetry                | Level configs as typed data plus pure hint predicates.                               |
| Hints                  | `src/hints`                              | engine, levels, telemetry, units        | Rule evaluation, ranking, template rendering, noise and headroom rules.              |
| Assist                 | `src/assist`                             | hints, telemetry                        | Correlation ranker with rule priors.                                                 |
| Game                   | `src/game`                               | all of the above, worker types, persist | Grid search, config hash, precomputed targets, level session, progress, prefs.       |
| Worker                 | `src/worker`                             | engine, game, levels                    | The only path from the UI to the engine.                                             |
| Export, Units, Persist | `src/export`, `src/units`, `src/persist` | engine types                            | CSV, unit conversion, versioned localStorage.                                        |

The non-UI layers never import `preact`, `@preact/signals`, `uplot`, `three`, or the UI directories
(`report`, `setup`, `app`, `debrief`, `viz3d`), except the logger `@/app/log`. Both rules are
lint-enforced (`eslint.config.js`) and tested (`tests/lint/boundaries.test.ts`).

Reactive state in `src/game` uses `@preact/signals-core` (framework-free). The same signal objects
can drive any UI, or none.

### 1.2 Data path of one run

```
LevelConfig + player Setup + runIndex
  → buildSimInput()            (worker)   effective setup, seed, conditions
  → simulate(input, 'full')    (worker)   Outcome + PhysicalColumns (48 channels @ 100 Hz)
  → createRunTelemetry()       (main)     lazy noisy/clean access to the level's channel set
                                          (physical + derived + distractors, + planted artifacts)
  → summarize()                (main)     min/max/mean per channel, clean and noisy, per segment
  → evaluateHints()            (main)     rules that fired, ranked
  → RunRecord                  (main)     appended to the LevelSession; progress folded in
```

The grid search runs the same engine in `'fast'` mode over the lever grid to find the level's
optimum and target before the first run (§9).

### 1.3 Determinism

- `simulate()` is a pure function: the same `SimInput` gives bit-identical columns and outcome,
  with or without the driver-plan cache (`tests/engine/golden.test.ts`).
- Every random stream is derived from the run seed with labelled forks (§2.3), so a run's noise,
  distractors and condition variation reproduce exactly from `(levelId, runIndex)`.
- The seed is accepted by the engine but the physics itself has no randomness; it is reserved.
- Floating point: SI `number` internally, `Float32Array` for logged columns and all channel
  series.

---

## 2. Conventions

### 2.1 Units

SI everywhere internally. Storage bases per quantity: time s, distance m, speed m/s, accel_g g,
force N, mass kg, temperature °C, pressure bar, angle deg, rpm 1/min, power W, rate_deg_s deg/s,
voltage V, current A, dbm dBm, altitude m, flow kg/s, percent 0–1, fraction 0–1, ratio and
dimensionless unitless, gear and angle_int integers.

`src/units` converts at the display edge with an affine map `display = si × factor + offset`:

| Quantity      | metric       | imperial       | decimals (m / i) |
| ------------- | ------------ | -------------- | ---------------- |
| time          | s            | s              | 3 / 3            |
| distance      | m            | ft             | 1 / 1            |
| speed         | km/h (×3.6)  | mph            | 1 / 1            |
| accel_g       | g            | g              | 2 / 2            |
| force         | kN (×0.001)  | lbf            | 2 / 0            |
| mass          | kg           | lb             | 1 / 1            |
| temperature   | °C           | °F (×1.8 + 32) | 1 / 1            |
| pressure      | bar          | psi            | 2 / 1            |
| ratio         | —            | —              | 3 / 3            |
| fraction      | —            | —              | 2 / 2            |
| angle         | °            | °              | 1 / 1            |
| angle_int     | —            | —              | 0 / 0            |
| rpm           | rpm          | rpm            | 0 / 0            |
| gear          | —            | —              | 0 / 0            |
| voltage       | V            | V              | 2 / 2            |
| current       | A            | A              | 1 / 1            |
| power         | kW (×0.001)  | hp             | 1 / 1            |
| rate_deg_s    | °/s          | °/s            | 1 / 1            |
| percent       | % (×100)     | %              | 1 / 1            |
| dbm           | dBm          | dBm            | 1 / 1            |
| altitude      | m            | ft             | 1 / 0            |
| flow          | kg/h (×3600) | lb/h           | 1 / 1            |
| dimensionless | —            | —              | 3 / 3            |

`formatValue` renders NaN as `—`, ±∞ as `∞`/`−∞`, and never prints negative zero.

### 2.2 Identifiers

- Channel ids are `snake_case`, stable forever (they appear in CSVs and saved layouts). No id may
  hint at irrelevance (`dummy_*`, `noise_*`).
- Lever ids: `throttle_ramp`, `tire_pressure`, `weight_dist`, `wing`.
- Level ids: `A1`, `A2`, `A3`, `A4`, `B1L`, `B4L` (`L` = "lite" variant).
- Segment ids are per track (e.g. `launch`, `fast_corner`, `run_stop`).

### 2.3 Seeded randomness

`createRng(seed)` (uint32) is **sfc32** seeded through splitmix32 from the key, with 12 warm-up
outputs discarded. It provides `next()` (uniform [0, 1)), `normal()` (Box–Muller, with the spare
value cached) and `fork(label)`, which returns an independent stream whose key is a 32-bit hash
(cyrb53, folded) of the label seeded with the parent key. A fork depends only on the parent's seed
and the label, never on how many values the parent has drawn.

Run seed: `runSeed(levelId, runIndex) = FNV-1a-32("${levelId}#${runIndex}")`. Run index 0 is the
grid search's fixed seed. Forks used: `'conditions'`, `'noise:' + channelId`,
`'distractor:' + channelId`.

### 2.4 Time base

Fixed timestep `DT = 0.01 s` (100 Hz logging). Maximum simulated time `MAX_TIME = 300 s`; beyond it
the run is unfinished (`totalTime = Infinity`, `finished = false`).

---

## 3. The car

One rigid body moving along a 1-D path, rear-wheel drive, with a four-corner load model deciding
each tire's grip. `DEFAULT_CAR` (round numbers near an IndyCar, labelled approximate; it models no
real vehicle). Levels may override any field (`LevelConfig.car`); none currently do.

| Symbol   | Field             | Value    | Meaning                                           |
| -------- | ----------------- | -------- | ------------------------------------------------- |
| m        | `mass`            | 750 kg   | Mass with driver (fuel separate, see `fuelMass0`) |
| P        | `power`           | 500 kW   | Engine power                                      |
| F_peak   | `fPeak`           | 5 800 N  | Low-speed engine force cap                        |
| C_d0·A   | `cd0A`            | 0.68 m²  | Drag area with no wing                            |
| k_d·A    | `kdA`             | 0.02 m²  | Drag area per wing step²                          |
| C_l0·A   | `cl0A`            | 1.4 m²   | Lift area with no wing                            |
| k_l·A    | `klA`             | 0.4 m²   | Lift area per wing step                           |
| b        | `aeroBalanceRear` | 0.48     | Share of downforce on the rear axle               |
| μ_peak   | `muPeak`          | 1.6      | Peak tire friction coefficient                    |
| k_s      | `kLoadSens`       | 0.1      | Tire load sensitivity                             |
| h        | `cogHeight`       | 0.30 m   | Centre of gravity height                          |
| L        | `wheelbase`       | 3.0 m    | Wheelbase                                         |
| t        | `trackWidth`      | 1.9 m    | Track width                                       |
| c_rr     | `crr`             | 0.015    | Rolling resistance coefficient                    |
| F_brk    | `brakeForceMax`   | 11 500 N | Total brake demand at full pedal (≈ 1.56 g)       |
| b_f      | `brakeBiasFront`  | 0.70     | Front brake bias, fixed                           |
| p_opt    | `pOpt`            | 1.7 bar  | Optimal tire pressure                             |
| σ_p      | `sigmaP`          | 0.4 bar  | Width of the pressure → μ bell                    |
| T_opt    | `tOpt`            | 90 °C    | Optimal tire temperature                          |
| σ_T      | `sigmaT`          | 25 °C    | Width of the temperature → μ bell                 |
| s_peak   | `sPeak`           | 0.10     | Slip ratio at peak force                          |
| k_slide  | `kSlide`          | 0.5      | Slip growth per unit excess demand while sliding  |
| —        | `slideFactor`     | 0.8      | Fraction of F_max delivered while sliding         |
| k_regrip | `kRegrip`         | 0.85     | Demand ratio below which a sliding axle regrips   |
| m_fuel   | `fuelMass0`       | 0 kg     | Fuel mass (not modelled)                          |
| q        | `arbFrontShare`   | 0.5      | Front share of lateral load transfer (fixed)      |

At mid wing (w = 4): C_d·A = 1.0 m², C_l·A = 3.0 m². N_ref = m·g/4 = 1 839 N. Rolling force
= 110 N. Full-pedal brake demand: 8 050 N front, 3 450 N rear.

Tuning history that explains the values (equations never changed): `fPeak` 10 → 5.8 kN so the A2
ramp optimum is interior (`μ·d·m·g < F_peak < μ·d·m·g / (1 − μ·h/L)`, ≈ 5.35…6.25 kN at d = 0.45);
`brakeBiasFront` 0.55 → 0.70 and `brakeForceMax` 16 → 11.5 kN so the front axle is the braking
limit and the A3 weight tradeoff has an interior optimum (fronts lock first only when
d > 1 − b_f + μ·h/L = 0.46); `pOpt` 1.65 → 1.7 and `sigmaP` 0.9 → 0.4 so the pressure bell is
visible in time on the 0.1 bar lever grid; `aeroBalanceRear` 0.55 → 0.48 so the corner balance sits
inside the weight lever; tire heat constants retuned so temperatures stay plausible (§4, row 15).

---

## 4. Physics model

Every equation is one line and has one implementing function. Rows number the model table used
throughout the code and the in-game model page. Physical constants: ρ = 1.225 kg/m³,
g = 9.81 m/s².

| Row | Equation                                                                                                                                                        | Notes                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | `CdA = cd0A + kdA·w²`, `ClA = cl0A + klA·w`                                                                                                                     | Wing w buys lift linearly, costs drag quadratically.                                                                   |
| 2   | `F_drag = ½ρ·CdA·v²`, `F_down = ½ρ·ClA·v²`                                                                                                                      |                                                                                                                        |
| 3   | `N_f = (1−d)·m·g + (1−b)·F_down`, `N_r = d·m·g + b·F_down`                                                                                                      | d = rear weight fraction (lever), b = aero balance.                                                                    |
| 4   | `ΔN = m·a_x·h/L`; `N_r += ΔN`, `N_f −= ΔN`                                                                                                                      | Uses the **previous step's** a_x. ΔN is clamped to `[−N_r, N_f]` so no axle goes negative and total load is conserved. |
| 5   | `μ_p = exp(−((p − p_opt)/σ_p)²)`                                                                                                                                | 1 when `pressureAffectsGrip` is off.                                                                                   |
| 6   | `μ_T = exp(−((T − T_opt)/σ_T)²)`                                                                                                                                | 1 when `tempAffectsGrip` is off (off on every level).                                                                  |
| 7   | `μ_i = μ_peak·μ_p·μ_T·G·(1 − k_s·(N_i − N_ref)/N_ref)`, `N_ref = m·g/4`                                                                                         | G = track grip multiplier. Load sensitivity: a loaded tire grips less per newton, so any transfer costs total grip.    |
| 8   | `F_max,axle = Σ_{i∈axle} μ_i·N_i`                                                                                                                               | ∞ when `tractionLimit` is off (the finite value is still logged as `grip_budget_*`).                                   |
| 9   | `θ(t) = t_ramp = 0 ? 1 : min(1, t/t_ramp)`; 0 while braking                                                                                                     | t since the last launch.                                                                                               |
| 10  | `F_eng = θ·min(F_peak, P / max(v, 0.5))`                                                                                                                        | Force-limited at low speed, power-limited above; applied at the rear axle.                                             |
| 11  | `F_bf = b_f·β·F_brk`, `F_br = (1−b_f)·β·F_brk`, `β ∈ {0, 1}`                                                                                                    | Full pedal only.                                                                                                       |
| 12  | `r = F_demand/F_max`; gripping: `F = F_demand`, `slip = s_peak·r`; sliding: `F = slideFactor·F_max`, `slip = min(1, s_peak + k_slide·max(0, r − k_regrip))`     | Per axle, per step.                                                                                                    |
| 12b | Slide hysteresis: an axle starts sliding when `r > 1` and stays sliding while `r ≥ k_regrip`; no demand (`F_demand ≤ 0`) or a drive↔brake switch ends the slide | A stab of throttle costs far more than the moment it happens in.                                                       |
| 13  | `m·dv/dt = F_x,rear + F_x,front − F_drag − F_roll`, `F_roll = c_rr·m·g`                                                                                         | Semi-implicit Euler at DT, `v ≥ 0`. F_x is signed (+ drive, − braking).                                                |
| 14  | Wheel speeds: driven rear under drive `v·(1 + slip_r)`; under braking `v·(1 − slip)` per axle; else v                                                           | Both wheels of an axle read the same.                                                                                  |
| 15  | `dT/dt = k_heat·(F_used/F_max)²·v·(sliding ? 2 : 1) − k_cool·(T − T_track)`                                                                                     | k_heat = 0.05, k_cool = 0.02 1/s. Per tire; `F_used/F_max` is the axle's grip used (§4.3). Starts at T_track.          |
| 16  | `dT/dt = k_brake·F_brake·v − k_bcool·(T − T_amb)`                                                                                                               | k_brake = 2·10⁻⁶, k_bcool = 0.05 1/s. Per axle; starts at T_amb.                                                       |
| 17  | `gear = 1 + floor(min(5, v/15))`; `rpm = 4000 + (v − 15·(gear−1))/15·8000`                                                                                      | Display sawtooth, no effect on motion.                                                                                 |
| 18  | `a_y = v²/R`; `F_y,f = m·a_y·(1−d)`, `F_y,r = m·a_y·d`                                                                                                          | The car follows the path exactly; lateral demand is fixed by speed and radius and split by static weight.              |
| 19  | `ΔN_lat = m·a_y·h/t`; front takes `q·ΔN_lat`, rear `(1−q)·ΔN_lat`; outside tire +, inside −                                                                     | Each axle's transfer is clamped to half its axle load (inside tire ≥ 0).                                               |
| 20  | `√(F_x² + F_y²) ≤ F_max`; `F_x,max = √(F_max² − F_y²)` (0 if `F_y ≥ F_max`)                                                                                     | The friction circle.                                                                                                   |
| 21  | `v_lim(R)` = largest v with `F_y,f ≤ F_max,f` and `F_y,r ≤ F_max,r`                                                                                             | Bisection, a_x = 0, tires at T_opt, tolerance 0.01 m/s, bracket [0, 200] m/s; 200 if grip never limits.                |
| 22  | `grip_used = √(F_x² + F_y²) / F_max`                                                                                                                            | Per axle, against the finite budget of row 8. 0 when F_max = 0 and no force; ∞ if force with no budget.                |

### 4.1 Grip assembly (`computeGrip`)

One function assembles rows 1–8 and 18–20 at an instant `(v, a_x,prev, κ, temps)`; the integrator,
the braking envelope and `cornerLimitSpeed` all call it, so the driver plans with exactly the
physics the car experiences. Order: drag and downforce (1–2); static loads (3); longitudinal
transfer with the previous step's a_x (4); lateral demand (18) and lateral transfer (19) to the
four corners (κ > 0 is a left turn, loading the right side); μ per tire (6–7); budgets (8) and the
longitudinal force left per axle (20). μ_T is applied per tire from the tire temperature array, or
assumed 1 (tires at T_opt) when the caller passes `null` (the driver's planning model).

### 4.2 Integration step

Each 10 ms step, with state `(t, s, v, a_x,prev, segment, t_launch, braking, slide states, tire temps,
brake temps)`:

1. **Grip** at the start-of-step state (§4.1), using the current segment's curvature.
2. **Driver** (§5.3) → β ∈ {0, 1} and θ ∈ [0, 1].
3. **Forces.** If β > 0: brake demands (11) through the tire model (12/12b) on each axle, within the
   friction circle (`F_x,max` from 20); engine force is zero. Else: `F_eng` (9–10) through the rear
   axle's tire model; front force zero. Slide state per axle carries from the previous step; the
   rear's slide also remembers whether it was a drive slide or a brake slide, and a mode change
   ends it.
4. **Motion** (13): `a = F_net/m`, `v' = max(0, v + a·DT)`, `s' = s + v'·DT`, `a_x' = (v' − v)/DT`.
5. **Temperatures** (15–16), explicit Euler from the current state. The heat ratio is the axle's
   grip used; with the traction limit off it is `√(F_x² + F_y²)/(μ_peak·N_axle)`.
6. **Log** the step (full mode only): the start-of-step state plus the forces applied this step.
   `long_g` is `a_x'/g` (this step's acceleration). `lat_g` is signed (+ left). Pose channels come
   from the track geometry at `s`.
7. **Advance**, then the divergence guard: a non-finite `v`, `s`, `a_x`, tire or brake temperature
   throws `SimDivergedError(step, stateSnapshot)`. Never silently clamped.
8. **Segment ends.**
   - A straight with `endsWithStop`: when braking and `v' < STOP_SPEED (0.05 m/s)`, the stop time is
     interpolated within the step (v is linear in t), `v` snaps to 0, `a_x` to 0, slide states and
     braking clear, the segment advances and `t_launch` is set to now (a relaunch from standstill).
   - Otherwise: every cumulative boundary crossed this step (`s' ≥ end`) records a crossing time by
     linear interpolation in `s`; the segment index advances past each. A stop segment is never
     crossed by distance.
   - Passing the last boundary finishes the run.

**Outcome:** `totalTime` = last boundary time; `segmentTimes[i]` = boundary*i − boundary*{i−1};
`topSpeed` = max v over the run; `finished`. An unfinished run (300 s cap) reports
`totalTime = ∞` and `∞` for every segment not reached.

**Start:** a standing start has `v = 0`, `t_launch = 0`. A rolling start (no current track uses one)
begins at `min(v_env(0), v_top)` with `t_launch = −10⁹` (full throttle available).

**Logging mode:** `'full'` records 48 channel columns plus `t`, `s`, `seg` (Uint8) into a growable
`Float32Array` store, trimmed to exact length at the end; `'fast'` runs the identical step function
and writes nothing. Both return the same outcome (guarantee 6).

### 4.3 Validation (`validateInput`)

Throws `SimInputError(field, message)` with a dotted path:

- `setup.throttle_ramp ∈ [0, 3.0]`, `setup.tire_pressure ∈ [1.2, 2.2]`, `setup.weight_dist ∈ (0, 1)`
  (the lever's 0.38–0.52 range is enforced by the level config, not the engine), `setup.wing` an
  integer in `[0, 8]`. Range checks carry a 10⁻⁹ slack for float-stepped values.
- `track.segments`: 1–255 segments; positive lengths; corners need a positive radius and a
  direction and may not end with a stop; `track.laps` must be 1.
- `conditions`: finite temperatures, `gripMultiplier ≥ 0`.
- `seed`: a uint32.

Car parameters are not range-checked (a malformed car is caught by the divergence guard).

### 4.4 Tracks and geometry

A track is `{ id, segments[], standingStart, laps: 1 }`. A segment is a straight (`length`,
optional `endsWithStop`) or a corner (`length` = arc = radius × angle, `radius`, `direction`).
Signed curvature κ = +1/R for a left (counter-clockwise) corner, −1/R right, 0 on straights.

Top-down geometry starts at (0, 0) heading +x (east); the pose at distance `s` is exact for
straights and arcs (closed-form chord integration), and `trackGeometry()` samples one point per
metre plus the end point (memoised by track fingerprint, 32 entries). The car follows the path
exactly, so `pos_x`, `pos_y`, `heading` are pure functions of `s`. Guarantee 9: a 90° corner turns
the heading by 90° ± 0.1°; logged positions lie on the polyline within 0.05 m.

Tracks in the build (all standing start, one lap):

| Track id                 | Segments (id: kind, length)                                                                                                                                    | Total     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `straight_1000` (A1, A2) | `launch`: straight 1000 m                                                                                                                                      | 1000 m    |
| `launch_stop_1000` (A3)  | `run_stop`: straight 1000 m, ends with stop                                                                                                                    | 1000 m    |
| `corner_80` (A4)         | `runup` 200 m · `corner` left R 80 m, 90° (125.66 m) · `runout` 150 m                                                                                          | 475.66 m  |
| `join_b1l` (B1L)         | `straight` 1000 m · `fast_corner` right R 150 m, 90° (235.62 m) · `run_out` 150 m                                                                              | 1385.62 m |
| `puzzle_b4l` (B4L)       | `main_straight` 1000 m · `fast_corner` right R 150 m, 90° · `back_straight` 500 m · `hairpin` right R 35 m, 180° (109.96 m) · `run_stop` 400 m, ends with stop | 2245.58 m |

### 4.5 Derived closed forms

- Power-limited top speed: root of `P = ½ρ·CdA·v³ + c_rr·m·g·v` (bisection). Full-throttle top
  speed: root of `min(F_peak, P/v) = ½ρ·CdA·v² + c_rr·m·g`; equals the power-limited speed unless
  drag balances F_peak below P/F_peak (very high wing). At wing 4: 86.47 m/s (311 km/h).

---

## 5. Driver model

The player does not drive. The driver is deterministic and setup-aware: it plans from the same
grip model the car runs on.

### 5.1 Corner limit speeds

Per segment: `v_lim = cornerLimitSpeed(R)` (row 21) for corners, ∞ for straights.

### 5.2 Braking envelope `v_env(s)`

A backward pass in distance at `ENVELOPE_DS = 0.25 m` builds the fastest speed at every point from
which full braking still reaches every later target.

- **Caps.** Every grid point inside a corner (closed interval) is capped at that corner's `v_lim`;
  a stop point is capped at 0 (and everything after a final stop stays 0).
- **Reach.** Stepping backward from `next` (the cap or curve at the next point):
  `reach = √(next² + 2·a·ds)`, `curve[k] = min(cap[k], reach)`, where `a` is the full-pedal
  deceleration at speed `next` on the curvature of that interval. Speeds above
  `v_reach = 1.1 × topSpeed(wing)` are treated as unbounded.
- **Deceleration with hysteresis (`brakingSweep`).** Because of row 12b, braking depends on where
  the pedal goes down: at onset the loads still carry the driving load transfer of the step before
  (`onsetAx`: traction-limited full-throttle acceleration on a straight, 0 in a corner), so an axle
  can lock at once and stay locked down the whole zone. The sweep follows the integrator's own
  step down in speed (`SLIDE_DV = 0.25 m/s`): loads from the previous entry's deceleration, the
  hysteresis rule on each axle, then the row-12 forces, drag and rolling.
- **Onset bands.** Onset speeds are split into bands at most `ONSET_DV = 5 m/s` wide and wherever
  the straight-line slide state shortly after onset (`SETTLE_STEPS = 16` sweep entries) changes.
  Each band gets its own backward pass braking as a car that started at the band's top would. The
  envelope is the lowest must-brake speed over the bands: `v_env[k] = min_j max(lo_j, curve_j[k])`
  over bands whose curve lies at or below the band top (never a maximum, since with hysteresis the
  stopping distance need not grow with onset speed). Bands are built only when the track has a
  braking target.
- **Lookup.** `envelopeAt(s)` interpolates linearly in v² (exact for constant deceleration). Beyond
  the end it reads 0 if the track ends with a stop, else the last value.

`brakingDecel` (steady-state, damped fixed-point coupling of deceleration and load transfer, 8
iterations, 4 slide-state passes) exists for tests and diagnostics; the envelope uses the sweep.

Accuracy test: the A3 stop lands within ±1.0 m of 1000 m for random valid setups.

### 5.3 Pedals each step (`driverInputs`)

Given `(s, v, t_sinceLaunch, ramp, wasBraking, v_lim of this segment, stopAt, m, F_eng,full,
resistance = drag + rolling, F_x,max,rear, rearSlidingUnderDrive)`:

1. **Brake** (β = 1, θ = 0) if `s ≥ stopAt`, or already braking for a stop (stay on the pedal until
   stopped; a release near standstill would crawl); else if in a corner and `v_env ≥ v_lim` the
   hold controller manages speed (no brake); else if `v ≥ v_env`, or already braking and
   `v > v_env − BRAKE_LATCH (0.3 m/s)` (the latch stops bang-bang chatter). A stopped car never
   brakes.
2. **Throttle** otherwise: `θ = ramp(t_sinceLaunch)` (row 9). In a corner:
   - if the rear arrived sliding under drive, lift for this step (`θ = 0`; no demand ends a slide,
     row 12b);
   - else hold `target = min(v_lim, v_env)`: `need = max(0, resistance + m·(target − v)/DT)`,
     `cap = min(need, F_x,max,rear)`, `θ = min(θ, cap / F_eng,full)`, then reduced by ulps until
     `θ·F_eng,full ≤ cap` so the demand ratio never rounds above 1 (an inclusive cap).

Guarantee 8: the hold speed equals `cornerLimitSpeed` within 0.5 % and mid-corner grip used is
in [0.97, 1.0].

### 5.4 Driver plan cache

The plan (corner limits, `v_top`, envelope) depends on car, track, conditions, flags and the levers
`tire_pressure`, `weight_dist`, `wing`, never on `throttle_ramp` or the seed. `SimCache` memoises
up to 64 plans per base key so grid searches that vary the ramp fastest reuse them. Results are
bit-identical with or without the cache.

---

## 6. Levers, setup, conditions, flags

### 6.1 Levers

| Lever           | Unit          | Engine range | Lever grid (min, max, step) | Points |
| --------------- | ------------- | ------------ | --------------------------- | ------ |
| `throttle_ramp` | s             | [0, 3.0]     | 0 … 3.0, 0.2                | 16     |
| `tire_pressure` | bar           | [1.2, 2.2]   | 1.2 … 2.2, 0.1              | 11     |
| `weight_dist`   | rear fraction | (0, 1)       | 0.38 … 0.52, 0.02           | 8      |
| `wing`          | integer       | [0, 8]       | 0 … 8, 1                    | 9      |

Levers are discrete: the grid search evaluates exactly these step points, and lever defaults must
lie on the grid. Grid values are built from integers (`min + i·step`, fixed to the step's
decimals) so they are exact.

### 6.2 Effective setup

```
effectiveSetup(level, playerSetup) =
  { ...FALLBACK, ...leverDefaults, ...playerSetup, ...level.lockedLevers }
```

with `FALLBACK = { throttle_ramp 0, tire_pressure 1.65, weight_dist 0.45, wing 4 }`. Locked levers
always win; levers the level neither unlocks nor locks fall back.

### 6.3 Conditions

`Conditions = { trackTemp °C, ambientTemp °C, gripMultiplier }` (dry 1.0; the design names damp 0.7
and wet 0.5, unused). Base for every level: 30 °C track, 20 °C ambient, grip 1.

Per-run variation (only where the level declares it; B4L: `gripFrac 0.01`, `trackTempC 3`): from
`createRng(seed).fork('conditions')`, `u₁, u₂ ~ U[−1, 1)`:
`gripMultiplier × (1 + gripFrac·u₁)`, `trackTemp + trackTempC·u₂`. The grid search always uses
base conditions. Both values are logged as the channels `grip_multiplier` and `track_temp`.

### 6.4 Model flags

| Flag                  | A1                    | A2 and later                             |
| --------------------- | --------------------- | ---------------------------------------- |
| `tractionLimit`       | false (infinite grip) | true                                     |
| `pressureAffectsGrip` | false                 | true                                     |
| `tempAffectsGrip`     | false                 | false (equation present, off everywhere) |

Load transfer is always on; it only becomes visible in the outcome once the traction limit is on
(the A2 → A3 lesson).

---

## 7. Telemetry

### 7.1 Registry

The channel registry holds 224 channels in a fixed order: 48 physical (engine) → 8 derived (math)
→ 168 distractors, each in declaration order. `RunTelemetry.channelIds` and CSV columns follow
registry order. Every entry has `id`, `label`, `quantity`, `group` (`timing`, `chassis`, `tires`,
`aero`, `powertrain`, `brakes`, `electrical`, `environment`, `misc`), a `source`, a `noise` spec
(`sigmaFrac`, `dropoutRate`), a nominal SI `range` (noise scale and axis default), optional
`quantum` (digital channels) and optional `clamp` (physical bounds). The full inventory is Appendix
A.

Roles are **not** on the registry entry. They are per level (`channelRoles`), so a channel can be a
distractor on one level and causal on another (`brake_temp_front`: distractor until braking is
unlocked).

### 7.2 Physical channels

Written by the integrator every step (Appendix A.1). Noise is per sensor class: primary sensors
(speed, wheel speeds, pedals, rpm, gear, loads, accelerations) σ 0.2–0.5 % of range; model
estimates (μ, grip, slip, forces) 0.5–1 %; other analogue channels (aero, temperatures, yaw,
steering, rolling) 1–2 %; `pos_x`, `pos_y`, `heading` are exact (no noise, no dropouts). Pedals
clamp to [0, 1], speeds to ≥ 0, gear to [1, 6] with quantum 1.

### 7.3 Derived channels

Computed by the "logger" from other channels, as a math channel would be. They add no noise of
their own: `get()` evaluates them over the noisy inputs (so sensor-based math inherits the sensors'
noise and dropouts), `getClean()` over the clean inputs. Timing channels depend only on `t`, `s`,
`seg` and stay exact.

| id                               | Definition                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delta_best`                     | This run's `t` minus the time the best run reached the same `s` (linear interpolation in s). Stationary plateaus (launch, stop) are matched sample-for-sample, so an identical run reads exactly 0 and standing longer than the best shows as a growing delta. All 0 when there is no best run yet. Positive = slower. |
| `segment_time`                   | `t − t_start(segment)`: running time within the current segment.                                                                                                                                                                                                                                                       |
| `segment_delta`                  | Time lost against the segment floor, accrued in proportion to the run's own elapsed time: `segment_time × (1 − floor_i / T_i)`, with `T_i` this run's time in segment i. 0 at each segment start, `T_i − floor_i` at its end, monotone between. All NaN when the level has no floors (only join levels).               |
| `top_speed`                      | Running maximum of `speed` (NaN skipped).                                                                                                                                                                                                                                                                              |
| `speed_diff_rl`, `speed_diff_rr` | `wheel_speed_xx − speed` (positive = wheelspin, negative = lock).                                                                                                                                                                                                                                                      |
| `corner_min_speed`               | Running minimum of `speed` within the current corner segment; NaN on straights. A segment is a corner when its mean `corner_limit_speed` exceeds 1 m/s (robust to noise).                                                                                                                                              |
| `exit_speed`                     | `speed` at the last sample of each corner, held until the next corner's exit; NaN before the first exit. A dropout on the exit sample falls back to the nearest earlier valid sample in that corner.                                                                                                                   |

### 7.4 Distractors

Real-looking sensors with no bearing on the setup. Every generator has the shape
`(n, dt, t, s, throttle, speed, rng, params) → Float32Array` and reads nothing else: never a lever,
never a physics channel beyond throttle and speed. Output is `lo + (hi − lo) × x` with `x`
clamped to [0, 1] (a sensor saturates). Every family draws a per-run **baseline**
`c ~ U[base0, base1]` so sensors differ run to run. Params are span fractions unless noted.

| Family          | Count | Model                                                                                                                                                                                 |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slow_drift`    | 60    | Fluid and component temperatures: `x += (θ·rise + (1−θ)·idle)·dt/100` plus a mean-reverting wander (`wander`, reversion 0.05 1/s).                                                    |
| `flat_noisy`    | 32    | Regulated quantities: `c + ripple·sin(2π·f·t + φ) + jitter·N(0,1)`.                                                                                                                   |
| `periodic`      | 8     | Radio fades, ambient wobble: fundamental with period `~U[period0, period1]` plus a 0.35 second harmonic, depth `depth`, jitter.                                                       |
| `random_walk`   | 36    | Ornstein–Uhlenbeck around `c`: `x += −revert·(x − c)·dt + sigma·√dt·N(0,1)`, started in the stationary distribution, plus jitter.                                                     |
| `step_events`   | 8     | Status bits and counters: Poisson switching at `rate`/min between `levels` discrete values; pulse mode returns to `base` after `U[dur0, dur1]` s; counter mode wanders ±1. Quantised. |
| `throttle_echo` | 10    | `c + gain·LP(θ, τ)`: a first-order lag of throttle (intake air temp, manifold pressure, fuel flow, EGTs, injector duty). Correlates with throttle, explains nothing.                  |
| `speed_echo`    | 14    | `c + gain·(LP(v, τ)/v_ref)^exp` (dynamic pressure has exp = 2): pitot and aero probe pressures, cooling ΔP, wing pillar strain. Correlates with speed, explains nothing.              |

The two echo families exist to tempt a naive correlation ranker (§10). Noise per distractor is fixed
by a hash of its id (σ 1–3 % of range, dropouts 0.05–0.2 %).

### 7.5 Noise layer

`noisy[i] = clean[i] + sigmaFrac × (hi − lo) × N(0, 1)`, or NaN with probability `dropoutRate`.
Digital channels are re-quantised after the noise; bounded channels are clamped last. Every sample
draws exactly one uniform and one normal regardless of outcome, so the sequence is stable. The
stream is `createRng(seed).fork('noise:' + id)`.

### 7.6 Run telemetry (`createRunTelemetry`)

Lazy, cached, deterministic access to every channel of one run for a level's channel set (ids are
sorted into registry order and de-duplicated).

- `getClean(id)`: physical → the engine column; derived → `compute()` over clean columns;
  distractor → the family generator with `fork('distractor:' + id)`.
- `get(id)`: derived → `compute()` over the noisy columns; otherwise the clean series; then the
  noise layer; then any planted artifacts for this run and channel.
- Returned arrays are shared cache entries; callers must not mutate them.

**Planted sensor artifacts** (`LevelConfig.artifacts`, filtered by run index): live in the sensor
layer only. `get()` applies them after noise; `getClean()` never sees them, so physics, hint rules,
the assist and the outcome ignore them. Kinds: `spike` (offset by `magnitude` for one sample or
`durationS`), `step` (offset from `at` to the end or for `durationS`), `stuck` (frozen at the value
at `at` plus `magnitude`). `at` picks the first sample with `t ≥ at.t`, else `s ≥ at.s`. An
artifact on a physical channel carries into math channels computed from it. Currently one exists:
B4L run 2, `speed_diff_rl`, spike +7.7 m/s at s = 612 m.

### 7.7 Run summary (`summarize`)

Per channel: `{ min, max, mean, argmin, argmax, tMin, tMax, dropouts }`, NaN-safe (dropouts skipped
and counted; an all-NaN series gives NaN stats with indices −1). Three views: `stats` over the
noisy series (what the player sees), `clean` over the clean series (what rules use), `perSegment`
(noisy, restricted to each segment). `window(id, pred)` returns the first and last time the
predicate holds on the clean series, or null. Stats are cached per run and channel.

When a run carries artifacts, the session builds a second telemetry without them and summarises
that for the hint rules, so no rule can react to a planted fault.

### 7.8 Channel roles and growth per level

| Level | Channels | Outcome | Causal | Correlated | Distractor | Signal ratio |
| ----- | -------- | ------- | ------ | ---------- | ---------- | ------------ |
| A1    | 16       | 2       | 4      | 7          | 3          | 1 in 4       |
| A2    | 25       | 3       | 5      | 11         | 6          | 1 in 5       |
| A3    | 32       | 3       | 4      | 16         | 9          | 1 in 8       |
| A4    | 41       | 3       | 4      | 21         | 13         | 1 in 10      |
| B1L   | 60       | 2       | 5      | 25         | 28         | 1 in 12      |
| B4L   | 224      | 3       | 8      | 45         | 168        | 1 in 28      |

Tests hold: roles cover exactly the channel set; signal-to-noise falls monotonically; the axle
force channels (`fx_*`, `fy_*`) are never causal; default strips (4–6 per level) never contain a
causal channel.

---

## 8. Hint engine

Hints are rule-based diagnostics computed from the run just completed. A rule is a pure predicate
over the run summary plus three tiers of templated text: **observe** (the channel and the
pattern), **explain** (the physics), **direct** (a lever and a direction, never a value).

### 8.1 Rule shape

```
HintRule {
  id, kind: 'fault' | 'headroom' | 'noise', fallback?: boolean,
  when(summary, ctx) → HintMatch | null,
  estTimeCost(summary, ctx) → seconds,
  tiers: [observe, explain, direct]
}
HintMatch { ruleId, vars, window?: { channel, tStart, tEnd }, channels[] }
HintCtx   { level, setup (effective), outcome, bestOutcome?, grid?, previousOutcome? }
```

`window` names a time span on one channel (the UI may shade it); `channels` are the channels the
rule reads (they feed the assist priors).

### 8.2 Evaluation and ranking (`evaluateHints`)

Every rule of the level is evaluated (a rule that throws is logged and skipped). Matches are ranked
by `estTimeCost` descending, ties in level rule order. If any non-fallback, non-noise rule fired,
fallback matches are dropped; otherwise they are kept. The result is stored on the run record; the
"top" hint is the first.

Rules are written against channel behaviour (slip above the peak-grip slip, μ below its peak,
grip used near 1), not against engine constants, so they survive retunes; car parameters a rule
needs (the pressure bell) are read from the level's effective car.

### 8.3 Template syntax

- `` `channel_id` `` → a channel segment (renderable as a link). Backticks are not part of the text.
- `{name}` → `vars.name` raw (numbers rounded to 3 decimals).
- `{name:quantity}` → `vars.name` formatted through the units layer in the player's unit system.
- `{name:channel}` → `vars.name` as a channel segment chosen at run time.

`renderTemplate` returns `{ text, segments: [{ kind: 'text' | 'channel' | 'value', value }] }`.
Tests hold that tier 3 never contains a numeric value, and that every channel id in a template is
on the level.

### 8.4 Shared thresholds

- `SLIP_LIMIT = 0.10`; sliding means `slip > 0.101` (a gripping tire at the limit sits at exactly
  s_peak in float32).
- `AT_LIMIT = 0.97` grip used counts as at the limit; `LIMIT_REACHED = 0.99` for "the rears used
  all their grip".
- `PRESSURE_RATIO_MIN = 0.99`: μ_p below 99 % of its peak counts as off-peak.
- `LOCK_MIN_FRACTION = 0.05`: a lock is a fault when the axle slides for more than 5 % of the
  braking.
- `RAMP_SLACK_STEPS = 1.5`: a ramp longer than 1.5 lever steps (0.3 s) can be "too gentle".
- Phase helpers: `brakeWindow` (first/last `brake > 0.01`), `rampWindow` (0 until throttle first
  ≥ 0.999), `peakInPhase` (peak of a channel before/after a cut time, by bisection on `window`),
  `driveSlide` (rear slide starting before the first brake application; a rear lock in a stop is
  not wheelspin).

### 8.5 Rule catalogue

| Rule id | Kind | Levels | Fires when | Est. cost (s) | Tier 3 direction |
| --------------------- | ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ | ---- | ----------------------------------------------------------- |
| `ramp_headroom` | headroom | A1 | throttle took > 0.05 s to reach full | `t_full / 2` | Shorten the throttle ramp |
| `drag_bend` | headroom (informational) | A1 | first run of the session (no best yet) | 0.001 | Shorten the ramp; drag is set by speed |
| `wheelspin` | fault | A2, B1L, B4L | rear slid under drive (before any braking) and pressure is not the lever | `0.1 + 0.25·duration` | Lengthen the throttle ramp until peak slip stays under 0.10 |
| `pressure_off_peak` | headroom | A2, A3, B1L, B4L | μ_p < 0.99·peak and the rears ran out of grip (slid, or grip used ≥ 0.99) | `0.6·(1 − μ_p)·T` (+1 if the slide began after the ramp ended) | Lower / Raise the tire pressure until `mu_rear` stops rising |
| `ramp_too_gentle` | headroom | A2, B1L, B4L | no drive slide, `long_g` still climbing when throttle reached full, ramp > 0.3 s, pressure not the lever | `0.25·t_full` | Shorten the throttle ramp |
| `front_lock` | fault | A3, B1L, B4L | front slip above 0.10 overlapping > 5 % of the braking, and weight can still move forward | `0.05 + 0.3·duration` | Move weight distribution toward the front |
| `rear_lock` | fault | A3, B4L | rear slip above 0.10 in the braking phase overlapping > 5 % of it, weight can move rearward | `0.05 + 0.3·duration` | Move weight distribution toward the rear |
| `launch_spin` | fault | A3; B1L, B4L (`withRamp`) | rear slide before braking, weight can move rearward; with `withRamp`, only if the fronts did not slide in the braking (rear weight is affordable) | `0.1 + 0.25·duration` (+0.01 with `withRamp`, to outrank `wheelspin`) | Move weight distribution toward the rear |
| `transfer_headroom` | headroom | A3, B4L | no spin or lock, braking exists, peak front grip used in braking < 0.97, weight can move rearward | 0.05 | Move weight distribution toward the rear |
| `corner_grip_limited` | headroom | A4; B1L, B4L (gated: a corner is clearly paying) | wing ≤ 5 and max grip used in segment 1 ≥ 0.97 | `0.02·(6 − wing)` | Raise the wing |
| `entry_lock` | fault | A4 | fronts locked braking into the corner (> 5 % of braking), wing below max | `0.05 + 0.3·duration` | Raise the wing |
| `drag_cost` | headroom | A4, B1L, B4L | wing ≥ max − 1 and segment 2 slower than on the best run | loss vs best | Lower the wing |
| `segment_paying` | headroom | B1L, B4L | one segment's end `segment_delta` ≥ 0.05 s and ≥ 2.5× every other segment's | `delta − next` | Raise (corner) / Lower (straight) the wing |
| `noise` | noise | B4L | `                                                                                                                                                 | T − T_prev                                                            | < 2σ` (§8.6) | `2σ` | Compare runs under like conditions; bigger change or repeat |
| `setup_headroom` | headroom, fallback | all | run finished over target, grid present, and a lever still moves the time (§8.7) | `T − target` | The lever and direction the grid names, plus a channel |

"Pressure is the lever" (`pressureIsTheLever`): the pressure lever is unlocked and μ_p < 0.99. On
such a run the ramp rules defer to the pressure rule (a longer ramp only delays the same spin).

### 8.6 Noise rule

Run-to-run σ from the level's declared grip variation, with time elasticity to grip
`e = d(ln T)/d(ln μ) ≈ 0.25` (measured 0.19–0.26 on the current tracks): one run's grip factor is
`1 + gripFrac·u`, `u ~ U[−1, 1)`, so `σ_T ≈ T·e·gripFrac/√3` and the difference of two runs has
`σ = √2·T·e·gripFrac/√3`. Track temperature does not move grip (μ_T off) and is ignored. The rule
fires when both runs finished and `|Δ| < 2σ`; it names `grip_multiplier` and `track_temp` where the
level logs them. On B4L (T ≈ 45 s) the band is ≈ 0.19 s.

### 8.7 Generic headroom rule

So hints never go silent while the run is off target. Needs `ctx.grid`.

- Tier 1 names the segment losing most against its floor (`segmentTimes[i] − segmentFloors[i]`).
- Tier 3 names the lever with the largest **marginal range at the current setup**: for each
  unlocked lever, the line through the current setup along that lever (others held where the
  player has them), timed from the grid samples. Unevaluated grid points (coarse → fine levels) are
  filled by inverse-distance weighting of the 4 nearest evaluated neighbours in lever-step space.
  Among levers whose line has a point faster than the current one by > 1 ms, pick the largest
  range and point toward the faster point. If no line improves (a coordinate-wise dip), fall back
  to each lever's profile (best time at each value over every other lever) and point the lever with
  the largest profile range toward its best value.
- The channel named is the first on the lever's direction list that exists on the level
  (ramp up: `rear_slip_ratio`, `speed_diff_rl`, `long_g`; ramp down: `long_g`, `rear_slip_ratio`,
  `throttle`; pressure: `mu_rear`, `grip_used_rear`; weight up: `load_rear`, `rear_slip_ratio`,
  `load_front`; weight down: `load_front`, `front_slip_ratio`, `load_rear`; wing up:
  `corner_min_speed`, `downforce`, `segment_delta`; wing down: `top_speed`, `drag_force`,
  `segment_delta`), else `segment_time`.

Tested property (`tests/levels/lessons.test.ts`, `silence.slow.test.ts`): following any fired
hint one step never makes the next run slower on A2; no finished off-target run is left without a
hint.

---

## 9. Target search

### 9.1 Grid search (`gridSearch`)

Runs in the worker (or Node), `'fast'` mode, base conditions, seed `runSeed(levelId, 0)`, one
`SimCache` for the whole search, `throttle_ramp` varying fastest.

- **Exhaustive** over the cartesian product of the unlocked levers' step grids when it has
  ≤ 5 000 points (A1: 16, A2: 176, A3: 1 408, A4: 9).
- **Coarse → fine** otherwise (B1L, B4L: 12 672 points): 6 evenly spaced points per lever
  (endpoints included, snapped to steps; 1 296 coarse points), then an exhaustive ±2-step box
  around each of the best 3 coarse points (stable sort; boxes deduplicated). Evaluated: 2 251 (B1L),
  2 376 (B4L).
- Output `GridResult`: `optimum { setup, outcome }`, `target = optimum.totalTime × (1 + tolerance)`,
  `segmentFloors[i]` = min over every evaluated setup of segment i's time, `samples` = every
  evaluated `{ setup, totalTime }` (the response-surface input), `evaluated`, `ms`, `configHash`.
- Progress callbacks at most every 50 ms and once with 1 at the end.

Note that `segmentFloors` come from the **engine's** per-segment minima over the evaluated grid
("engine floor"), not from the player's Phase A bests (see §14).

### 9.2 Config hash and cache

`configHash(level)` = cyrb53 (14 hex digits) of a key-sorted JSON of: `GRID_ALGO_VERSION` (1), the
track, unlocked levers (`id, min, max, step`), locked levers, flags, the effective car, base
conditions, tolerance. Not covered: text, channels, hint rules, run budget, and engine _equation_
changes (a slow test recomputes every stored target to catch those).

`loadGrid` resolves in order: in-memory promise cache keyed `${levelId}:${configHash}` → the
build's precomputed table (used only on an exact key match) → a live worker search. A failed
search is evicted so the next call retries.

### 9.3 Precomputed targets

`scripts/precompute-targets.ts` runs as `prebuild` and writes `src/game/precomputed-targets.json`
(`{ version: 1, entries: { "<levelId>:<hash>": GridResult } }`), rewritten only when a result
differs (ignoring `ms`); non-finite numbers are stored as the strings `"Infinity"`, `"-Infinity"`,
`"NaN"`. Samples are kept unless the file would exceed ~1.5 MB, in which case they are evenly
downsampled.

Current entries (base conditions):

| Level | Optimum setup (ramp s, pressure bar, weight, wing) | Optimum time | Target           | Segment times at optimum                | Segment floors                          |
| ----- | -------------------------------------------------- | ------------ | ---------------- | --------------------------------------- | --------------------------------------- |
| A1    | 0, 1.7, 0.45, 4 (locked except ramp)               | 18.504 s     | 18.689 s         | 18.504                                  | 18.504                                  |
| A2    | 0.2, 1.7, 0.45, 4                                  | 18.610 s     | 18.796 s         | 18.610                                  | 18.610                                  |
| A3    | 0.2, 1.7, 0.44, 4                                  | 21.191 s     | 21.350 s         | 21.191                                  | 21.191                                  |
| A4    | 0.2, 1.7, 0.44, 8                                  | 13.755 s     | 13.824 s         | 7.765 / 2.931 / 3.060                   | 7.597 / 2.931 / 3.057                   |
| B1L   | 0.2, 1.7, 0.48, 3                                  | 24.687 s     | gap rule (§10.1) | 18.521 / 3.890 / 2.276                  | 18.318 / 3.532 / 2.192                  |
| B4L   | 0.2, 1.7, 0.46, 3                                  | 45.215 s     | 45.441 s         | 18.535 / 3.909 / 7.950 / 4.531 / 10.289 | 18.318 / 3.421 / 7.827 / 4.364 / 10.161 |

B1L: best achievable gap = 24.687 − 24.042 = 0.645 s; pass limit = 0.645 + 0.005 × 24.687 = 0.768 s.

---

## 10. Game rules: session, scoring, progression

### 10.1 Pass criteria

- **Time levels** (A1–A4, B4L): a run passes when `totalTime ≤ target = T_opt × (1 + tolerance)`.
  Tolerances: 1 % (A1, A2), 0.75 % (A3, so the weight tradeoff decides the pass: 3 of 8 weights
  pass at otherwise optimal settings), 0.5 % (A4, B4L).
- **Compromise-gap level** (B1L, `scoreTarget: 'compromise_gap'`): `gap = totalTime − Σ segmentFloors`;
  a run passes when `gap ≤ bestAchievableGap + 0.005 × T_opt`, with
  `bestAchievableGap = T_opt − Σ segmentFloors`. The slack is additive because a multiplicative slack
  on a gap that can be 0 would only ever pass the exact optimum. Best run on this level is the
  minimum gap.
- Unfinished runs never pass and score ∞.
- `passOn` is `'any_run'` on every level (`'total'` is reserved and treated as `'any_run'`).

### 10.2 Session (`startLevel(level, client)`)

Live state of one level attempt, as signals:

- `grid`, `gridProgress`: the target search result (null while computing) and 0–1 progress.
- `runs: RunRecord[]`, dense 1-based indices. Runs are queued and processed one at a time.
- `best`: the run with the lowest score value (time, or gap on B1L).
- `runsUsed` = run count. **There is no run budget**: `run()` never refuses; `LevelConfig.runBudget`
  and `hintCost` are retained in the configs but ignored by the session.
- `hintsOpened`: hint tiers opened this session (free, but counted). `hintTiersOpened` (0–3) is for
  the current top hint and resets to 0 when a new run's top rule differs from the previous run's.
  `openHintTier()` returns the top match of the latest run, or null when none or all three tiers
  are open.
- `runsToTarget`: index of the first passing run (the **score**, lower is better); `hintsAtPass`:
  hints opened at that moment. `status`: `'computing' | 'ready' | 'passed'` (never exhausted).
- `assistOn` (B4L): recorded on each run as `assistOn`.
- `call` / `answerCall(optionId)`: the "Make the call" answer (§10.5), once per session, only after
  run `afterRun` exists, costs nothing.

`run(setup)`: awaits the grid, asks the worker for `runIndex = runs.length + 1`, builds telemetry
with `best` = the best run **before** this one (for `delta_best`) and the grid's segment floors,
summarises, evaluates hints with `bestOutcome` and `previousOutcome` in the context, appends the
record. A failed simulation rejects and consumes nothing.

```
RunRecord { index, setup (effective), seed, conditions (after variation), outcome,
            telemetry, summary, hints (ranked), assistOn }
```

### 10.3 Progress and unlocking (`signal.v1.progress`, envelope v2)

```
LevelProgress { passed, bestRunsToTarget | null, hintsOpenedThen | null, bestTime | null,
                attempts, runs, segmentBests?: number[],
                runsToTarget?: { assisted: number[], unassisted: number[] }   // B4L }
```

- Folded in after every run (`recordResult` is incremental and idempotent per session): run count,
  best time, per-segment bests; on the first pass of a session, `passed`, and the best score keeps
  the fewest runs (ties: fewer hints). On B4L the passing run's `assistOn` decides which
  runs-to-target list it joins.
- **Unlock:** level `i` opens when level `i−1` is passed **or** has `UNLOCK_AFTER_RUNS = 5` runs
  without a pass. B4L opens after any run on B1L. The first level is always open.
- Retrying a level starts a fresh session (new `attempts`); the old session's runs are kept in
  memory as lightweight `{ summary, outcome, hints }` for the assist pool.
- Migration: v1 progress (score = runs left) converts on first read; scores are discarded, passes,
  best times, segment bests and the B4L history are kept; a completed v1 level keeps the next one
  unlocked.

`segmentBests` are recorded but not used as Phase B floors in this build (§14).

### 10.4 Hint cost and score, as built

Hints are free and counted. The score is runs to target, shown with the hints opened by then
("Target met in 4 runs · 1 hint"). Neither the run budget nor the "runs remaining" score of the
design spec is in effect.

### 10.5 Make the call

A level may declare a `call`: after run `afterRun`, a question about a planted reading with
2–4 options, exactly one correct, each with a one-sentence `why`, plus `crossCheck` channels that
tell a real effect from a sensor fault. The question template gets `value` (the planted reading,
SI), `at` (m) and `t` (s) from the first artifact on that run. The answer is recorded on the
session (`{ afterRun, optionId, correct, atRun }`), costs no runs, and is available to the debrief.
B4L's call concerns the one-sample `speed_diff_rl` spike on run 2; the correct answer is to flag
and cross-check (`rear_slip_ratio`, `wheel_speed_rl`, `speed`, `long_g`).

### 10.6 Demo profile

`?demo=1` activates a profile where every level is unlocked and a recorded unassisted B4L attempt
(`src/app/demo-history.json`: four setups and seeds only, no times) is re-simulated on load through
a private session with the normal worker, grid, telemetry and hints. Its runs join the assist pool
and give the debrief a "recorded attempt" runs-to-target. Stored seeds are checked against
`runSeed()`; the current `runSeed` always wins.

---

## 11. The assist

Rank channels by how they move with lap time across the runs so far, with the hint rules that
fired acting as priors. Pure and deterministic; it never names a lever or a value.

- **Runs considered:** the recorded demo attempt (if any, same level), earlier sessions of this
  level in this browser session, then the live session's finished runs. Fewer than
  `ASSIST_MIN_RUNS = 3` finished runs → no rows.
- **Channels ranked:** the level's channel set minus outcome-role channels (`segment_time`,
  `delta_best`, `top_speed` move with lap time by definition).
- **Feature per channel per run:** a clean stat (`mean`, `max` or `min`); by default whichever of
  the three has the largest |r|.
- **r:** Pearson correlation of the feature with `totalTime` across the runs (0 for a constant or
  non-finite feature; guarded against float-noise "variation").
- **prior:** 1 if any fired hint across the runs names the channel in its `channels`, else 0.
- **score** = `RULE_WEIGHT·prior + (1 − RULE_WEIGHT)·|r|`, `RULE_WEIGHT = 0.6`; ties break on |r|,
  then id. Top `ASSIST_TOP = 5` rows.
- **reason:** the observe tier of the most recent rule naming the channel, rendered in the player's
  units; otherwise "moves with lap time (r = ±0.xx)".

`demotedEcho` (for the debrief): the first run count n ≥ 3 at which raw correlation alone
(`ruleWeight = 0`) put an echo-family distractor (`throttle_echo`, `speed_echo`) in the top 5 while
the priors kept it out, with its raw rank.

---

## 12. Levels as built

Common to all: standing start, one lap, dry base conditions, `hintCost [1,1,1]` and `runBudget`
retained but ignored (§10.2), `passOn 'any_run'`, debrief = two physics sentences plus the causal
channel list. `surfaceLevers` names the two unlocked levers a response surface should plot (the
level's own lever first); absent, the two with the largest marginal range are used.

| Id  | Title                        | Concept                        | Track              | Unlocked levers (default)                         | Locked                                               | Tol.   | Budget (ignored) | Scored on      |
| --- | ---------------------------- | ------------------------------ | ------------------ | ------------------------------------------------- | ---------------------------------------------------- | ------ | ---------------- | -------------- |
| A1  | Throttle                     | Drag, F = ma                   | `straight_1000`    | ramp (1.0 s)                                      | pressure 1.7, weight 0.45, wing 4                    | 1 %    | 5                | time           |
| A2  | Grip                         | Traction limit                 | `straight_1000`    | ramp (0), pressure (1.9)                          | weight 0.45, wing 4                                  | 1 %    | 6                | time           |
| A3  | Weight                       | Longitudinal load transfer     | `launch_stop_1000` | ramp (0.4), pressure (1.7), weight (0.50)         | wing 4                                               | 0.75 % | 6                | time           |
| A4  | Corner                       | Friction circle, aero tradeoff | `corner_80`        | wing (2)                                          | ramp 0.2, pressure 1.7, weight 0.44 (= A3's optimum) | 0.5 %  | 7                | time           |
| B1L | Join: straight + fast corner | The aero compromise            | `join_b1l`         | ramp (0), pressure (1.7), weight (0.44), wing (5) | —                                                    | 0.5 %  | 8                | compromise gap |
| B4L | The Puzzle                   | Everything, plus the assist    | `puzzle_b4l`       | ramp (0), pressure (1.8), weight (0.46), wing (7) | —                                                    | 0.5 %  | 10               | time           |

Per level:

- **A1.** Flags: no traction limit, pressure off. Causal: `speed`, `long_g`, `drag_force`,
  `engine_force`. Rules: `ramp_headroom`, `drag_bend`, `setup_headroom`. Lesson held by test:
  time is monotone non-decreasing in the ramp, optimum 0.
- **A2.** Grip flags on. Causal: `rear_slip_ratio`, `speed_diff_rl`, `wheel_speed_rl`, `mu_rear`,
  `grip_used_rear`. Rules: `wheelspin`, `pressure_off_peak`, `ramp_too_gentle`, `setup_headroom`.
  Held: the ramp optimum is interior (0.2 s; ramp 0 spins, +0.33 s; each further 0.2 s costs
  ≈ 0.1 s) and robust for F_peak 5.5–6.1 kN; pressure is single-peaked on the grid with ≥ 0.1 % per
  step either side of 1.7 bar.
- **A3.** Causal: `load_front`, `load_rear`, `front_slip_ratio`, `rear_slip_ratio`. Rules:
  `front_lock`, `rear_lock`, `launch_spin`, `transfer_headroom`, `pressure_off_peak`,
  `setup_headroom`. Surface levers: weight × ramp. Held: the weight optimum is interior (0.44); at
  it neither axle slides; the rears lock in the stop only with too little rear weight (0.40) and
  the fronts only with too much (0.50); at most 3 of 8 weights pass.
- **A4.** Causal: `lat_g`, `corner_min_speed`, `exit_speed`, `downforce`. Rules:
  `corner_grip_limited`, `drag_cost`, `entry_lock`, `setup_headroom`. Held: the wing alone reaches
  the target with an optimum ≥ 5 (it is 8); the default (2) does not pass.
- **B1L.** Causal: `segment_delta`, `drag_force`, `top_speed`, `corner_min_speed`, `downforce`.
  Rules: `segment_paying`, `launch_spin` (withRamp), `wheelspin`, `front_lock` ("under braking"),
  `corner_grip_limited` (gated), `drag_cost`, `pressure_off_peak`, `ramp_too_gentle`,
  `setup_headroom`. `segmentFloorSource: 'engine_optimum'`. Surface: wing × weight. Held
  (guarantee 7): the B1L wing optimum (3) is strictly lower than A4's (8).
- **B4L.** Channel set = the whole registry (224). Causal: `rear_slip_ratio`, `front_slip_ratio`,
  `load_front`, `load_rear`, `drag_force`, `speed_diff_rl`, `mu_rear`, `segment_delta`. Rules: the
  union of A2, A3, A4 and B1L plus `noise` and `setup_headroom` (12 rules, §8.5). Conditions vary
  per run (grip ±1 %, track temp ±3 °C). `assist: true`. One planted artifact and the call (§10.5).
  Surface: weight × ramp. The start setup carries one fault per earlier lesson: pressure off its
  peak (A2), no ramp with the fronts locking in the stop (A3), the A4 wing on a track with two long
  straights (B1).

Lever direction note: in this engine a **longer** ramp reduces wheelspin, so A2's tier 3 says
"Lengthen".

---

## 13. Contracts the UI consumes

These are the seams a redesigned flow and UI build on. Nothing below needs to change for a new
presentation; everything above is reachable only through them.

### 13.1 Worker RPC (`SimClient`)

The only way the UI reaches the engine. Main → worker requests `{ id, type, payload }`; worker →
main `{ id, ok: true, value }`, `{ id, ok: false, error: { name, message, detail? } }` or
`{ id, progress }`.

| Method       | Request                            | Response                                                                                      |
| ------------ | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `ping`       | `{ sentAt }`                       | `{ reply: 'pong', sentAt }`                                                                   |
| `run`        | `{ levelId, setup, runIndex ≥ 1 }` | `RunPayload { seed, conditions, outcome, physical }` (column buffers transferred, not copied) |
| `gridSearch` | `{ levelId }`                      | `GridResult` (progress events ≤ every 50 ms)                                                  |

Levels are resolved in the worker from `LEVELS`; the main thread sends only ids and setups.
`SimInputError` and `SimDivergedError` are reconstructed by name across the boundary with their
fields; anything else becomes `Error` named `WorkerError`. The worker is a classic (IIFE) bundle
so it also runs from `file://`; the single-file build inlines it.

### 13.2 Game layer

- `startLevel(level, client) → LevelSession` (§10.2); `runPasses`, `firstPassIndex`,
  `scoreValue`, `compromiseGap`, `bestAchievableGap`, `gapPassLimit`.
- `getProgress()`, `recordResult(levelId, session)`, `isUnlocked(levelId)`, `canMoveOn(progress)`.
- `loadGrid(level, client, onProgress)`; `gridKey(level)`.
- `LEVELS` (unlock order), `getLevel(id)`, `LevelConfig` (§12 fields plus `brief`, `defaultStrips`,
  `channelSet`, `channelRoles`, `debrief`, `call`, `artifacts`, `surfaceLevers`).
- `effectiveSetup(level, partial)`, `LEVER_RANGES`.

### 13.3 Telemetry and hints

- `RunTelemetry { n, dt, t, s, seg, channelIds, get(id), getClean(id) }`; `summarize(rt)`;
  `getChannel(id)`, `allChannels()`, `channelRange(id)`, `channelQuantum(id)`, `GROUP_ORDER`,
  `inRegistryOrder(ids)`; `segmentStartTimes`, `segmentCount`.
- `evaluateHints(level, summary, ctx)`, `ruleFor(level, match)`, `renderTier(rule, match, tier,
units)`, `renderTemplate(template, vars, units)` → `HintText { text, segments }`.
- `rankChannels(args) → AssistRow[] { channel, r, score, reason, fromRule }`, `assistChannels(level)`,
  `describer(level, units)`, `isEchoChannel(id)`, `demotedEcho(args)`; constants `RULE_WEIGHT`,
  `ASSIST_TOP`, `ASSIST_MIN_RUNS`.
- Response-surface data (`src/viz3d/surface-data.ts`) and waterfall data (`waterfall-data.ts`) are
  pure builders over `GridResult.samples` and run records (IDW fill with 4 neighbours in
  normalised step space; marginal ranges per lever). They are presentation-neutral geometry and
  may be reused or replaced.

### 13.4 Units, export, persistence

- `units`: `toDisplay`, `fromDisplay`, `formatValue`, `precision`, `unitLabel`, `minSpan`,
  `displayBounds`, `QUANTITIES`, `UNIT_SYSTEMS`.
- `toCsv(runTelemetry, { levelId, run, seed, setup, units })` (§13.5).
- `load(key, version, fallback)` / `save(key, version, value)` under the `signal.v1.` namespace,
  envelope `{ v, data }`; never throws (missing, corrupt, wrong version or unavailable storage
  falls back with a warning).

Persisted keys today: `progress` (v2, §10.3) and the display prefs (v1): `units` ('metric'),
`axisMode` ('distance'), `layout` (strip ids, global across levels), `layoutSmooth`, `projector`,
`playbackSpeed` (1 | 2 | 4), `playbackMode` ('realtime' | 'instant'), `density`. The prefs are UI
state and are free to change with the redesign; `progress` is game state and should keep its
envelope version or migrate.

### 13.5 CSV export (format v0.3)

```
# signal v0.3
"# <disclaimer>"                       one quoted cell
# level: A2
# run: 3
# seed: 12345
# units: metric
"# setup: {""throttle_ramp"":0.4,…}"   one RFC 4180 quoted cell
t,s,<every channel of the level set in registry order>
s,m,<unit labels in the display system; '' for unitless>
0.000,0.0,…                           one row per sample, converted, fixed to the quantity's precision
```

Dropouts are empty cells; ±∞ is `inf` / `-inf`; negative zero is never written. Planted artifacts
are included (they live in `get()`).

### 13.6 Game flow as the backend sees it

Independent of screens, the state machine a UI must drive:

1. **Select a level** that `isUnlocked`. Starting it creates a session and begins `loadGrid`
   (precomputed in normal builds, otherwise a worker search with progress).
2. **Set** a setup on the unlocked levers (locked ones are fixed by the config).
3. **Run** (`session.run`). Available at any time once the grid is ready; no budget.
4. **Read** the `RunRecord`: outcome, deltas (against `grid.target` or the gap limit), telemetry
   channels, summary, ranked hints (`hints[0]` is the top).
5. **Hint** (`openHintTier`): tiers 1–3 of the top hint, free, counted.
6. **Call** (B4L, after run 2): `answerCall` once.
7. **Pass** when `runsToTarget` becomes non-null; progress is folded after every run regardless,
   and the next level unlocks on pass or after 5 runs. The debrief data (causal channels, physics
   sentences, optimum vs best, every fired rule with all tiers, runs-to-target with/without assist,
   the call answer, the response surface samples) is all on the session, the level config and the
   progress record.
8. **Retry** starts a fresh session; prior runs stay in the assist pool.

---

## 14. Departures from the design spec (`signal.md`)

Built differently:

- **Stack:** Preact + TypeScript + Vite with a web worker, not one vanilla-JS file without a build.
  A single-file offline build (`dist-single/signal.html`) preserves the "runs anywhere" intent.
- **Runs and hints:** no run budget and free hints; the score is runs to target (plus hints shown),
  not runs remaining with hint costs subtracted. `runBudget` and `hintCost` remain in the configs.
- **Unlocking:** pass, or 5 runs without a pass; B4L after any B1L run.
- **Phase B floors:** the engine's per-segment grid minima ("engine floor"), not the player's
  isolated Phase A bests (those are recorded in progress as `segmentBests` but unused). The B1L
  pass rule is additive (`gap ≤ best gap + 0.5 % of T_opt`).
- **A4** unlocks only the wing; ramp, pressure and weight are locked at A3's optimum.
- **A3** tolerance 0.75 %, brake bias fixed at 70 % front.
- **B4L** is an open circuit of five segments (straight, fast right, back straight, hairpin, run to
  a stop) rather than the B1–B3 track plus two unseen segments; 224 channels rather than ~200;
  four levers.
- **Channel noise** is per sensor class (0.2–3 % of range) rather than a flat 1–3 %.
- **Added beyond the spec:** derived math channels (`segment_delta`, `speed_diff_*`,
  `corner_min_speed`, `exit_speed`), the generic headroom and noise rules, planted sensor artifacts
  and "Make the call", the demo profile, precomputed targets, axle force channels, logged run
  conditions, a config-hash cache.

Not built (design-spec content with no implementation):

- Levels A5 Balance (anti-roll bars), A6 Heat, A7 Conditions, B2 (slow corner), B3 (stint with fuel
  and wear); the levers `arb_front`, `arb_rear`, `fuel_load`, `aggression`.
- Tire temperature affecting grip (`tempAffectsGrip` is off everywhere; temperatures are computed
  and logged), tire wear, fuel mass (`fuelMass0 = 0`), multi-lap runs (`laps` must be 1), damp and
  wet grip multipliers.
- Yaw dynamics (the car follows the path exactly; grip limits only speed), suspension and pitch
  dynamics (load transfer is instantaneous, one step lagged), gear-shift dynamics.

---

## 15. Invariants held by tests

Engine guarantees (`tests/engine/guarantees.test.ts`):

1. A1 (traction off): time is monotone non-decreasing in the ramp; optimum 0.
2. A2: the time-optimal ramp is strictly inside (0, 3.0) at p_opt with ≥ 1 % spread, robust for
   F_peak 5.5–6.1 kN; ramp 0 spins the rears past 0.10, the optimum does not; the optimal pressure
   lies inside the lever range and includes p_opt.
3. A3: the optimal weight is strictly inside [0.38, 0.52] with ≥ 0.5 % spread; at 0.52 the fronts
   lock under braking.
4. Power-limited top speed matches `P = ½ρCdA·v³ + c_rr·m·g·v` within 0.5 %; below P/F_peak the
   top speed is force-limited.
5. Load conservation: `Σ N_i = m·g + F_down` at every step within 10⁻⁶ relative.
6. `'fast'` and `'full'` modes give deep-equal outcomes.
7. The aero compromise: A4's optimal wing ≥ 5; B1L's is strictly lower.
8. Corner hold: hold speed = `cornerLimitSpeed` within 0.5 %; mid-corner grip used ∈ [0.97, 1.0].
9. Track geometry: a 90° corner turns the heading by 90° ± 0.1°; logged positions lie on the
   geometry within 0.05 m.
10. Performance: a 1 km segment in full mode runs in < 30 ms (3× slack in CI).

Also held: bit-identical columns for identical input and with/without `SimCache` (golden outcomes
file); `SimDivergedError` on a forced NaN; the A3 stop lands within ±1 m; `√(fx² + fy²)/F_max`
equals `grip_used` per axle within 10⁻⁶; wheel speeds diverge from ground speed under spin and
lock; precomputed targets recompute bit-for-bit (slow test); every level's lever defaults lie on
the grid, locked levers are not unlocked, roles cover the channel set, default strips are never
causal, tier-3 texts contain no values, every template channel exists on the level; A2 one-step
hint following never slows the next run; A3 at most 3 of 8 weights pass; A4 wing alone passes with
optimum ≥ 5; no third-party team or company names ship (hygiene test over `src/`, `docs/`, builds).

---

## Appendix A. Channel inventory

Generated from the registry (`src/telemetry/physical-defs.ts`, `derived.ts`,
`distractor-defs.ts`). Ranges are nominal SI spans used to scale noise and as default axes.

### A.1 Physical channels (48, engine order)

| id                   | quantity      | group       | nominal range (SI) | σ (fraction of range) | dropout rate | clamp              | description                                                                                   |
| -------------------- | ------------- | ----------- | ------------------ | --------------------- | ------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| `speed`              | speed         | chassis     | [0, 90]            | 0.003                 | 0.001        | [0, ∞]             | Ground speed of the car along the path.                                                       |
| `long_g`             | accel_g       | chassis     | [-2.5, 1.5]        | 0.005                 | 0.001        |                    | Longitudinal acceleration (positive forward).                                                 |
| `drag_force`         | force         | aero        | [0, 4000]          | 0.015                 | 0.001        |                    | Aerodynamic drag, ½ρ·CdA·v².                                                                  |
| `downforce`          | force         | aero        | [0, 12000]         | 0.015                 | 0.001        |                    | Aerodynamic downforce, ½ρ·ClA·v².                                                             |
| `engine_force`       | force         | powertrain  | [0, 10000]         | 0.01                  | 0.001        |                    | Engine force at the rear wheels, θ·min(F_peak, P/v).                                          |
| `throttle`           | percent       | powertrain  | [0, 1]             | 0.003                 | 0.001        | [0, 1]             | Throttle position, 0 to 1.                                                                    |
| `brake`              | percent       | brakes      | [0, 1]             | 0.003                 | 0.001        | [0, 1]             | Brake pedal, 0 or 1 (the driver brakes at full pedal).                                        |
| `engine_rpm`         | rpm           | powertrain  | [4000, 12000]      | 0.002                 | 0.001        |                    | Engine speed (sawtooth through the gears).                                                    |
| `gear`               | gear          | powertrain  | [1, 6]             | 0.003                 | 0.001        | [1, 6] (quantum 1) | Selected gear, 1 to 6.                                                                        |
| `load_fl`            | force         | chassis     | [0, 6000]          | 0.005                 | 0.001        |                    | Vertical load on the front-left tire.                                                         |
| `load_fr`            | force         | chassis     | [0, 6000]          | 0.005                 | 0.001        |                    | Vertical load on the front-right tire.                                                        |
| `load_rl`            | force         | chassis     | [0, 6000]          | 0.005                 | 0.001        |                    | Vertical load on the rear-left tire.                                                          |
| `load_rr`            | force         | chassis     | [0, 6000]          | 0.005                 | 0.001        |                    | Vertical load on the rear-right tire.                                                         |
| `lat_g`              | accel_g       | chassis     | [0, 3]             | 0.005                 | 0.001        |                    | Lateral acceleration v²/r (positive turning left).                                            |
| `steering_angle`     | angle         | chassis     | [0, 5]             | 0.02                  | 0.001        |                    | Geometric steering angle L/r (positive left).                                                 |
| `heading`            | angle         | chassis     | [-180, 180]        | 0                     | 0            |                    | Heading on the top-down map (0 = east, counter-clockwise).                                    |
| `grip_budget_front`  | force         | tires       | [0, 15000]         | 0.01                  | 0.001        |                    | Front axle grip budget Σ μ_i·N_i.                                                             |
| `grip_budget_rear`   | force         | tires       | [0, 15000]         | 0.01                  | 0.001        |                    | Rear axle grip budget Σ μ_i·N_i.                                                              |
| `grip_used_front`    | fraction      | tires       | [0, 1]             | 0.01                  | 0.001        |                    | Front axle grip used, √(Fx² + Fy²)/F_max.                                                     |
| `grip_used_rear`     | fraction      | tires       | [0, 1]             | 0.01                  | 0.001        |                    | Rear axle grip used, √(Fx² + Fy²)/F_max.                                                      |
| `fx_front`           | force         | tires       | [-15000, 15000]    | 0.005                 | 0.001        |                    | Front axle longitudinal tire force (+ drive, − braking): the row-12 force actually delivered. |
| `fy_front`           | force         | tires       | [-15000, 15000]    | 0.005                 | 0.001        |                    | Front axle lateral tire force toward the corner centre, m·a_y·(1−d) (row 18).                 |
| `fx_rear`            | force         | tires       | [-15000, 15000]    | 0.005                 | 0.001        |                    | Rear axle longitudinal tire force (+ drive, − braking): the row-12 force actually delivered.  |
| `fy_rear`            | force         | tires       | [-15000, 15000]    | 0.005                 | 0.001        |                    | Rear axle lateral tire force toward the corner centre, m·a_y·d (row 18).                      |
| `front_slip_ratio`   | ratio         | tires       | [0, 0.5]           | 0.01                  | 0.001        |                    | Front slip ratio (lock under braking).                                                        |
| `rear_slip_ratio`    | ratio         | tires       | [0, 0.5]           | 0.01                  | 0.001        |                    | Rear slip ratio (wheelspin under drive, lock under braking).                                  |
| `wheel_speed_fl`     | speed         | tires       | [0, 90]            | 0.003                 | 0.001        | [0, ∞]             | Front-left wheel speed.                                                                       |
| `wheel_speed_fr`     | speed         | tires       | [0, 90]            | 0.003                 | 0.001        | [0, ∞]             | Front-right wheel speed.                                                                      |
| `wheel_speed_rl`     | speed         | tires       | [0, 90]            | 0.003                 | 0.001        | [0, ∞]             | Rear-left wheel speed.                                                                        |
| `wheel_speed_rr`     | speed         | tires       | [0, 90]            | 0.003                 | 0.001        | [0, ∞]             | Rear-right wheel speed.                                                                       |
| `tire_temp_fl`       | temperature   | tires       | [20, 140]          | 0.01                  | 0.001        |                    | Front-left tire temperature.                                                                  |
| `tire_temp_fr`       | temperature   | tires       | [20, 140]          | 0.01                  | 0.001        |                    | Front-right tire temperature.                                                                 |
| `tire_temp_rl`       | temperature   | tires       | [20, 140]          | 0.01                  | 0.001        |                    | Rear-left tire temperature.                                                                   |
| `tire_temp_rr`       | temperature   | tires       | [20, 140]          | 0.01                  | 0.001        |                    | Rear-right tire temperature.                                                                  |
| `brake_temp_front`   | temperature   | brakes      | [20, 900]          | 0.01                  | 0.001        |                    | Front brake temperature.                                                                      |
| `brake_temp_rear`    | temperature   | brakes      | [20, 900]          | 0.01                  | 0.001        |                    | Rear brake temperature.                                                                       |
| `mu_front`           | dimensionless | tires       | [0, 2]             | 0.01                  | 0.001        |                    | Front axle mean tire friction coefficient μ_i.                                                |
| `mu_rear`            | dimensionless | tires       | [0, 2]             | 0.01                  | 0.001        |                    | Rear axle mean tire friction coefficient μ_i.                                                 |
| `rolling_force`      | force         | chassis     | [0, 300]           | 0.02                  | 0.001        |                    | Rolling resistance, crr·m·g.                                                                  |
| `power_used`         | power         | powertrain  | [0, 500000]        | 0.01                  | 0.001        |                    | Engine power delivered, F_engine·v.                                                           |
| `load_front`         | force         | chassis     | [0, 12000]         | 0.005                 | 0.001        |                    | Total vertical load on the front axle.                                                        |
| `load_rear`          | force         | chassis     | [0, 12000]         | 0.005                 | 0.001        |                    | Total vertical load on the rear axle.                                                         |
| `yaw_rate`           | rate_deg_s    | chassis     | [0, 60]            | 0.015                 | 0.001        |                    | Yaw rate v/r (positive turning left).                                                         |
| `pos_x`              | distance      | chassis     | [-2000, 2000]      | 0                     | 0            |                    | Top-down position, x (east).                                                                  |
| `pos_y`              | distance      | chassis     | [-2000, 2000]      | 0                     | 0            |                    | Top-down position, y (north).                                                                 |
| `corner_limit_speed` | speed         | chassis     | [0, 90]            | 0.01                  | 0.001        |                    | Limit speed of the current corner (0 on straights).                                           |
| `track_temp`         | temperature   | environment | [0, 60]            | 0.004                 | 0.001        |                    | Track surface temperature this run (the run conditions; it varies run to run).                |
| `grip_multiplier`    | dimensionless | environment | [0.8, 1.1]         | 0.005                 | 0.001        |                    | Track grip multiplier this run (the run conditions; dry is 1).                                |

### A.2 Derived (math) channels (8)

| id                 | label                       | quantity | group   | nominal range (SI) |
| ------------------ | --------------------------- | -------- | ------- | ------------------ |
| `delta_best`       | Delta to best run           | time     | timing  | [-5, 5]            |
| `segment_time`     | Segment time                | time     | timing  | [0, 120]           |
| `segment_delta`    | Segment delta to floor      | time     | timing  | [-2, 5]            |
| `top_speed`        | Top speed                   | speed    | timing  | [0, 90]            |
| `speed_diff_rl`    | Wheel slip speed rear left  | speed    | tires   | [-20, 20]          |
| `speed_diff_rr`    | Wheel slip speed rear right | speed    | tires   | [-20, 20]          |
| `corner_min_speed` | Corner minimum speed        | speed    | chassis | [0, 90]            |
| `exit_speed`       | Corner exit speed           | speed    | chassis | [0, 90]            |

### A.3 Distractor channels (168, registry order)

Noise per sensor is fixed by a hash of the id: σ ∈ {1, 1.5, 2, 2.5, 3} % of range, dropout rate
∈ {0.05, 0.1, 0.15, 0.2} %, unless the entry overrides it. Params are span fractions (see §7.4).

| id                        | label                                 | quantity      | group       | family        | range (SI)      | σ     | dropout |
| ------------------------- | ------------------------------------- | ------------- | ----------- | ------------- | --------------- | ----- | ------- |
| `oil_temp`                | Engine oil temperature                | temperature   | powertrain  | slow_drift    | [80, 125]       | 0.02  | 0.001   |
| `oil_pressure`            | Engine oil pressure                   | pressure      | powertrain  | flat_noisy    | [3.5, 6]        | 0.02  | 0.002   |
| `oil_level`               | Oil tank level                        | fraction      | powertrain  | flat_noisy    | [0.55, 0.9]     | 0.03  | 0.0005  |
| `water_temp`              | Coolant temperature                   | temperature   | powertrain  | slow_drift    | [75, 105]       | 0.02  | 0.0015  |
| `water_pressure`          | Coolant pressure                      | pressure      | powertrain  | slow_drift    | [1, 2.5]        | 0.03  | 0.002   |
| `radiator_out_temp`       | Radiator outlet temperature           | temperature   | powertrain  | slow_drift    | [60, 95]        | 0.015 | 0.002   |
| `gearbox_temp`            | Gearbox oil temperature               | temperature   | powertrain  | slow_drift    | [70, 120]       | 0.02  | 0.0015  |
| `gearbox_oil_pressure`    | Gearbox oil pressure                  | pressure      | powertrain  | flat_noisy    | [2, 4]          | 0.03  | 0.0005  |
| `diff_temp`               | Differential oil temperature          | temperature   | powertrain  | slow_drift    | [60, 110]       | 0.03  | 0.001   |
| `clutch_temp`             | Clutch temperature                    | temperature   | powertrain  | slow_drift    | [80, 250]       | 0.03  | 0.0015  |
| `fuel_pressure`           | Fuel rail pressure                    | pressure      | powertrain  | flat_noisy    | [5.8, 6.2]      | 0.015 | 0.0015  |
| `fuel_temp`               | Fuel temperature                      | temperature   | powertrain  | slow_drift    | [25, 45]        | 0.01  | 0.0015  |
| `airbox_temp`             | Airbox temperature                    | temperature   | powertrain  | slow_drift    | [25, 50]        | 0.03  | 0.001   |
| `crankcase_pressure`      | Crankcase pressure                    | pressure      | powertrain  | random_walk   | [0.85, 1]       | 0.015 | 0.0015  |
| `hydraulic_pressure`      | Hydraulic system pressure             | pressure      | powertrain  | flat_noisy    | [180, 210]      | 0.02  | 0.0005  |
| `hydraulic_temp`          | Hydraulic fluid temperature           | temperature   | powertrain  | slow_drift    | [50, 90]        | 0.015 | 0.0005  |
| `accumulator_pressure`    | Hydraulic accumulator pressure        | pressure      | powertrain  | random_walk   | [120, 160]      | 0.03  | 0.002   |
| `lambda_bank_1`           | Lambda bank 1                         | ratio         | powertrain  | flat_noisy    | [0.8, 1]        | 0.025 | 0.001   |
| `lambda_bank_2`           | Lambda bank 2                         | ratio         | powertrain  | flat_noisy    | [0.8, 1]        | 0.015 | 0.0005  |
| `cam_error_inlet`         | Inlet cam position error              | angle         | powertrain  | random_walk   | [-2, 2]         | 0.015 | 0.001   |
| `cam_error_exhaust`       | Exhaust cam position error            | angle         | powertrain  | random_walk   | [-2, 2]         | 0.02  | 0.002   |
| `intake_air_temp`         | Intake air temperature                | temperature   | powertrain  | throttle_echo | [25, 55]        | 0.025 | 0.0005  |
| `manifold_pressure`       | Manifold absolute pressure            | pressure      | powertrain  | throttle_echo | [0.3, 1.05]     | 0.02  | 0.002   |
| `fuel_flow`               | Fuel flow                             | flow          | powertrain  | throttle_echo | [0, 0.03]       | 0.025 | 0.0015  |
| `egt_1`                   | Exhaust gas temperature cylinder 1    | temperature   | powertrain  | throttle_echo | [550, 950]      | 0.01  | 0.002   |
| `egt_2`                   | Exhaust gas temperature cylinder 2    | temperature   | powertrain  | throttle_echo | [550, 950]      | 0.03  | 0.001   |
| `egt_3`                   | Exhaust gas temperature cylinder 3    | temperature   | powertrain  | throttle_echo | [550, 950]      | 0.025 | 0.0015  |
| `egt_4`                   | Exhaust gas temperature cylinder 4    | temperature   | powertrain  | throttle_echo | [550, 950]      | 0.01  | 0.002   |
| `egt_5`                   | Exhaust gas temperature cylinder 5    | temperature   | powertrain  | throttle_echo | [550, 950]      | 0.03  | 0.001   |
| `egt_6`                   | Exhaust gas temperature cylinder 6    | temperature   | powertrain  | throttle_echo | [550, 950]      | 0.025 | 0.0015  |
| `ecu_temp`                | ECU internal temperature              | temperature   | powertrain  | slow_drift    | [40, 75]        | 0.03  | 0.002   |
| `ecu_cpu_load`            | ECU CPU load                          | percent       | powertrain  | flat_noisy    | [0.3, 0.7]      | 0.025 | 0.002   |
| `ecu_ref_5v`              | ECU 5 V sensor reference              | voltage       | powertrain  | flat_noisy    | [4.95, 5.05]    | 0.03  | 0.0005  |
| `ecu_fuel_trim_b1`        | ECU fuel trim bank 1                  | ratio         | powertrain  | random_walk   | [-0.08, 0.08]   | 0.01  | 0.001   |
| `ecu_fuel_trim_b2`        | ECU fuel trim bank 2                  | ratio         | powertrain  | random_walk   | [-0.08, 0.08]   | 0.015 | 0.0005  |
| `ecu_ign_advance`         | ECU ignition advance                  | angle         | powertrain  | random_walk   | [15, 35]        | 0.01  | 0.001   |
| `ecu_knock_retard_b1`     | ECU knock retard bank 1               | angle         | powertrain  | step_events   | [0, 4]          | 0.01  | 0.001   |
| `ecu_knock_retard_b2`     | ECU knock retard bank 2               | angle         | powertrain  | step_events   | [0, 4]          | 0.02  | 0.0015  |
| `ecu_status`              | ECU status code                       | angle_int     | powertrain  | step_events   | [0, 3]          | 0.02  | 0.002   |
| `ecu_inj_duty`            | ECU injector duty cycle               | percent       | powertrain  | throttle_echo | [0, 1]          | 0.025 | 0.0005  |
| `battery_voltage`         | Battery voltage                       | voltage       | electrical  | flat_noisy    | [13.6, 14.4]    | 0.02  | 0.0005  |
| `battery_temp`            | Battery temperature                   | temperature   | electrical  | slow_drift    | [25, 45]        | 0.03  | 0.001   |
| `alternator_current`      | Alternator current                    | current       | electrical  | flat_noisy    | [10, 45]        | 0.03  | 0.001   |
| `logger_temp`             | Data logger temperature               | temperature   | electrical  | slow_drift    | [30, 60]        | 0.025 | 0.0005  |
| `logger_supply_voltage`   | Data logger supply voltage            | voltage       | electrical  | flat_noisy    | [11.8, 12.2]    | 0.01  | 0.0005  |
| `pdm_current_fuel_pump`   | PDM current fuel pump                 | current       | electrical  | flat_noisy    | [6, 12]         | 0.025 | 0.002   |
| `pdm_current_ignition`    | PDM current ignition                  | current       | electrical  | flat_noisy    | [2, 6]          | 0.02  | 0.001   |
| `pdm_current_injectors`   | PDM current injectors                 | current       | electrical  | flat_noisy    | [3, 8]          | 0.02  | 0.002   |
| `pdm_current_ecu`         | PDM current ECU                       | current       | electrical  | flat_noisy    | [1, 3]          | 0.02  | 0.002   |
| `pdm_current_dash`        | PDM current dash                      | current       | electrical  | flat_noisy    | [0.5, 1.5]      | 0.03  | 0.001   |
| `pdm_current_radio`       | PDM current radio                     | current       | electrical  | flat_noisy    | [0.2, 2]        | 0.01  | 0.002   |
| `pdm_current_fans`        | PDM current cooling fans              | current       | electrical  | flat_noisy    | [4, 20]         | 0.02  | 0.001   |
| `pdm_current_logger`      | PDM current data logger               | current       | electrical  | flat_noisy    | [0.5, 1.5]      | 0.025 | 0.001   |
| `ers_soc`                 | ERS battery state of charge           | percent       | electrical  | random_walk   | [0.4, 0.8]      | 0.01  | 0.001   |
| `ers_dc_bus_voltage`      | ERS DC bus voltage                    | voltage       | electrical  | flat_noisy    | [650, 800]      | 0.02  | 0.001   |
| `ers_battery_temp`        | ERS battery temperature               | temperature   | electrical  | slow_drift    | [30, 50]        | 0.03  | 0.0015  |
| `ers_inverter_temp`       | ERS inverter temperature              | temperature   | electrical  | slow_drift    | [40, 70]        | 0.015 | 0.001   |
| `ers_mguk_temp`           | ERS MGU-K temperature                 | temperature   | electrical  | slow_drift    | [50, 110]       | 0.03  | 0.002   |
| `cell_temp_01`            | ERS cell temperature 01               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.03  | 0.0005  |
| `cell_temp_02`            | ERS cell temperature 02               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.01  | 0.0015  |
| `cell_temp_03`            | ERS cell temperature 03               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.015 | 0.001   |
| `cell_temp_04`            | ERS cell temperature 04               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.03  | 0.0005  |
| `cell_temp_05`            | ERS cell temperature 05               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.01  | 0.0015  |
| `cell_temp_06`            | ERS cell temperature 06               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.015 | 0.001   |
| `cell_temp_07`            | ERS cell temperature 07               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.02  | 0.002   |
| `cell_temp_08`            | ERS cell temperature 08               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.015 | 0.001   |
| `cell_temp_09`            | ERS cell temperature 09               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.02  | 0.002   |
| `cell_temp_10`            | ERS cell temperature 10               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.02  | 0.0005  |
| `cell_temp_11`            | ERS cell temperature 11               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.015 | 0.0015  |
| `cell_temp_12`            | ERS cell temperature 12               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.01  | 0.002   |
| `cell_temp_13`            | ERS cell temperature 13               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.03  | 0.001   |
| `cell_temp_14`            | ERS cell temperature 14               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.025 | 0.0015  |
| `cell_temp_15`            | ERS cell temperature 15               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.02  | 0.0005  |
| `cell_temp_16`            | ERS cell temperature 16               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.015 | 0.0015  |
| `cell_temp_17`            | ERS cell temperature 17               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.01  | 0.002   |
| `cell_temp_18`            | ERS cell temperature 18               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.01  | 0.0005  |
| `cell_temp_19`            | ERS cell temperature 19               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.03  | 0.001   |
| `cell_temp_20`            | ERS cell temperature 20               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.025 | 0.002   |
| `cell_temp_21`            | ERS cell temperature 21               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.03  | 0.0015  |
| `cell_temp_22`            | ERS cell temperature 22               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.015 | 0.0015  |
| `cell_temp_23`            | ERS cell temperature 23               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.02  | 0.001   |
| `cell_temp_24`            | ERS cell temperature 24               | temperature   | electrical  | slow_drift    | [28, 48]        | 0.03  | 0.0015  |
| `damper_pos_fl`           | Damper travel front left              | percent       | chassis     | random_walk   | [0, 1]          | 0.025 | 0.002   |
| `damper_pos_fr`           | Damper travel front right             | percent       | chassis     | random_walk   | [0, 1]          | 0.03  | 0.001   |
| `damper_pos_rl`           | Damper travel rear left               | percent       | chassis     | random_walk   | [0, 1]          | 0.03  | 0.0005  |
| `damper_pos_rr`           | Damper travel rear right              | percent       | chassis     | random_walk   | [0, 1]          | 0.02  | 0.0015  |
| `damper_temp_fl`          | Damper temperature front left         | temperature   | chassis     | slow_drift    | [30, 60]        | 0.03  | 0.001   |
| `damper_temp_fr`          | Damper temperature front right        | temperature   | chassis     | slow_drift    | [30, 60]        | 0.03  | 0.0015  |
| `damper_temp_rl`          | Damper temperature rear left          | temperature   | chassis     | slow_drift    | [30, 60]        | 0.01  | 0.0015  |
| `damper_temp_rr`          | Damper temperature rear right         | temperature   | chassis     | slow_drift    | [30, 60]        | 0.02  | 0.0005  |
| `wheel_vert_g_fl`         | Hub vertical acceleration front left  | accel_g       | chassis     | random_walk   | [-3, 5]         | 0.015 | 0.001   |
| `wheel_vert_g_fr`         | Hub vertical acceleration front right | accel_g       | chassis     | random_walk   | [-3, 5]         | 0.025 | 0.0015  |
| `wheel_vert_g_rl`         | Hub vertical acceleration rear left   | accel_g       | chassis     | random_walk   | [-3, 5]         | 0.03  | 0.002   |
| `wheel_vert_g_rr`         | Hub vertical acceleration rear right  | accel_g       | chassis     | random_walk   | [-3, 5]         | 0.025 | 0.001   |
| `vert_g`                  | Vertical acceleration                 | accel_g       | chassis     | random_walk   | [0.6, 1.4]      | 0.01  | 0.0005  |
| `steering_torque`         | Steering torque (N·m)                 | dimensionless | chassis     | random_walk   | [-5, 5]         | 0.02  | 0.0005  |
| `strain_tierod_fl`        | Tie rod strain front left             | force         | chassis     | random_walk   | [-1500, 1500]   | 0.01  | 0.0015  |
| `strain_tierod_fr`        | Tie rod strain front right            | force         | chassis     | random_walk   | [-1500, 1500]   | 0.03  | 0.0005  |
| `strain_toelink_rl`       | Toe link strain rear left             | force         | chassis     | random_walk   | [-1500, 1500]   | 0.015 | 0.002   |
| `strain_toelink_rr`       | Toe link strain rear right            | force         | chassis     | random_walk   | [-1500, 1500]   | 0.015 | 0.0015  |
| `strain_steering_column`  | Steering column strain                | force         | chassis     | random_walk   | [-400, 400]     | 0.015 | 0.002   |
| `power_steering_pressure` | Power steering pressure               | pressure      | chassis     | random_walk   | [30, 90]        | 0.025 | 0.0005  |
| `tpms_battery_fl`         | TPMS sensor battery front left        | voltage       | tires       | flat_noisy    | [2.8, 3.1]      | 0.03  | 0.0005  |
| `tpms_battery_fr`         | TPMS sensor battery front right       | voltage       | tires       | flat_noisy    | [2.8, 3.1]      | 0.03  | 0.001   |
| `tpms_battery_rl`         | TPMS sensor battery rear left         | voltage       | tires       | flat_noisy    | [2.8, 3.1]      | 0.02  | 0.0015  |
| `tpms_battery_rr`         | TPMS sensor battery rear right        | voltage       | tires       | flat_noisy    | [2.8, 3.1]      | 0.03  | 0.0005  |
| `tpms_rssi_fl`            | TPMS signal strength front left       | dbm           | tires       | periodic      | [-85, -55]      | 0.01  | 0.0015  |
| `tpms_rssi_fr`            | TPMS signal strength front right      | dbm           | tires       | periodic      | [-85, -55]      | 0.01  | 0.001   |
| `tpms_rssi_rl`            | TPMS signal strength rear left        | dbm           | tires       | periodic      | [-85, -55]      | 0.03  | 0.0015  |
| `tpms_rssi_rr`            | TPMS signal strength rear right       | dbm           | tires       | periodic      | [-85, -55]      | 0.01  | 0.001   |
| `rim_temp_fl`             | Rim temperature front left            | temperature   | tires       | slow_drift    | [35, 75]        | 0.025 | 0.001   |
| `rim_temp_fr`             | Rim temperature front right           | temperature   | tires       | slow_drift    | [35, 75]        | 0.02  | 0.002   |
| `rim_temp_rl`             | Rim temperature rear left             | temperature   | tires       | slow_drift    | [35, 75]        | 0.02  | 0.0005  |
| `rim_temp_rr`             | Rim temperature rear right            | temperature   | tires       | slow_drift    | [35, 75]        | 0.03  | 0.001   |
| `hub_bearing_temp_fl`     | Hub bearing temperature front left    | temperature   | tires       | slow_drift    | [40, 90]        | 0.02  | 0.001   |
| `hub_bearing_temp_fr`     | Hub bearing temperature front right   | temperature   | tires       | slow_drift    | [40, 90]        | 0.02  | 0.001   |
| `hub_bearing_temp_rl`     | Hub bearing temperature rear left     | temperature   | tires       | slow_drift    | [40, 90]        | 0.015 | 0.0015  |
| `hub_bearing_temp_rr`     | Hub bearing temperature rear right    | temperature   | tires       | slow_drift    | [40, 90]        | 0.03  | 0.001   |
| `caliper_temp_fl`         | Brake caliper temperature front left  | temperature   | brakes      | slow_drift    | [80, 220]       | 0.015 | 0.0005  |
| `caliper_temp_fr`         | Brake caliper temperature front right | temperature   | brakes      | slow_drift    | [80, 220]       | 0.02  | 0.002   |
| `caliper_temp_rl`         | Brake caliper temperature rear left   | temperature   | brakes      | slow_drift    | [80, 220]       | 0.02  | 0.0015  |
| `caliper_temp_rr`         | Brake caliper temperature rear right  | temperature   | brakes      | slow_drift    | [80, 220]       | 0.02  | 0.001   |
| `brake_pad_wear_fl`       | Brake pad remaining front left        | percent       | brakes      | flat_noisy    | [0.6, 0.95]     | 0.02  | 0.0005  |
| `brake_pad_wear_fr`       | Brake pad remaining front right       | percent       | brakes      | flat_noisy    | [0.6, 0.95]     | 0.02  | 0.0005  |
| `brake_pad_wear_rl`       | Brake pad remaining rear left         | percent       | brakes      | flat_noisy    | [0.6, 0.95]     | 0.015 | 0.001   |
| `brake_pad_wear_rr`       | Brake pad remaining rear right        | percent       | brakes      | flat_noisy    | [0.6, 0.95]     | 0.03  | 0.001   |
| `brake_fluid_temp_front`  | Brake fluid temperature front         | temperature   | brakes      | slow_drift    | [50, 110]       | 0.01  | 0.001   |
| `brake_fluid_temp_rear`   | Brake fluid temperature rear          | temperature   | brakes      | slow_drift    | [50, 110]       | 0.01  | 0.0015  |
| `brake_duct_temp_front`   | Brake duct air temperature front      | temperature   | brakes      | random_walk   | [30, 60]        | 0.025 | 0.0015  |
| `brake_duct_temp_rear`    | Brake duct air temperature rear       | temperature   | brakes      | random_walk   | [30, 60]        | 0.01  | 0.002   |
| `brake_fluid_level`       | Brake fluid reservoir level           | fraction      | brakes      | flat_noisy    | [0.85, 1]       | 0.01  | 0.0015  |
| `pitot_dp_1`              | Pitot differential pressure 1         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.02  | 0.002   |
| `pitot_dp_2`              | Pitot differential pressure 2         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.025 | 0.001   |
| `pitot_dp_3`              | Pitot differential pressure 3         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.03  | 0.002   |
| `pitot_dp_4`              | Pitot differential pressure 4         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.02  | 0.0015  |
| `pitot_dp_5`              | Pitot differential pressure 5         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.025 | 0.001   |
| `pitot_dp_6`              | Pitot differential pressure 6         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.03  | 0.002   |
| `pitot_dp_7`              | Pitot differential pressure 7         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.01  | 0.0015  |
| `pitot_dp_8`              | Pitot differential pressure 8         | pressure      | aero        | speed_echo    | [0, 0.06]       | 0.03  | 0.0005  |
| `cooling_air_dp`          | Radiator duct differential pressure   | pressure      | aero        | speed_echo    | [0, 0.03]       | 0.01  | 0.002   |
| `strain_wing_pillar_l`    | Rear wing pillar strain left          | force         | aero        | speed_echo    | [0, 5000]       | 0.01  | 0.0005  |
| `strain_wing_pillar_r`    | Rear wing pillar strain right         | force         | aero        | speed_echo    | [0, 5000]       | 0.015 | 0.002   |
| `strain_floor_l`          | Floor edge strain left                | force         | aero        | speed_echo    | [0, 3000]       | 0.015 | 0.002   |
| `strain_floor_r`          | Floor edge strain right               | force         | aero        | speed_echo    | [0, 3000]       | 0.02  | 0.0015  |
| `aero_yaw_angle`          | Aero probe yaw angle                  | angle         | aero        | random_walk   | [-4, 4]         | 0.01  | 0.001   |
| `aero_pitch_angle`        | Aero probe pitch angle                | angle         | aero        | random_walk   | [-2, 2]         | 0.015 | 0.001   |
| `sidepod_air_temp`        | Sidepod exit air temperature          | temperature   | aero        | random_walk   | [30, 60]        | 0.02  | 0.001   |
| `drs_status`              | DRS status                            | angle_int     | aero        | step_events   | [0, 1]          | 0.02  | 0.0015  |
| `ambient_pressure`        | Ambient pressure                      | pressure      | environment | periodic      | [1.005, 1.02]   | 0.02  | 0.002   |
| `ambient_air_temp`        | Ambient air temperature               | temperature   | environment | random_walk   | [18, 30]        | 0.015 | 0.0015  |
| `humidity`                | Relative humidity                     | percent       | environment | random_walk   | [0.35, 0.75]    | 0.03  | 0.001   |
| `wind_speed`              | Wind speed                            | speed         | environment | random_walk   | [0, 8]          | 0.02  | 0.002   |
| `wind_direction`          | Wind direction                        | angle         | environment | random_walk   | [0, 360]        | 0.015 | 0.0005  |
| `gps_altitude`            | GPS altitude                          | altitude      | environment | random_walk   | [144.5, 145.5]  | 0.03  | 0.0005  |
| `gps_sat_count`           | GPS satellites in view                | angle_int     | environment | step_events   | [8, 14]         | 0.025 | 0.0015  |
| `gps_hdop`                | GPS horizontal dilution               | ratio         | environment | random_walk   | [0.6, 1.6]      | 0.025 | 0.0015  |
| `gps_speed`               | GPS speed                             | speed         | environment | speed_echo    | [0, 90]         | 0.01  | 0.002   |
| `beacon_rssi`             | Lap beacon signal strength            | dbm           | timing      | periodic      | [-90, -50]      | 0.02  | 0.001   |
| `gps_time_offset`         | GPS time offset                       | time          | timing      | random_walk   | [-0.005, 0.005] | 0.02  | 0.002   |
| `logger_buffer_fill`      | Logger buffer fill                    | percent       | timing      | periodic      | [0.05, 0.4]     | 0.02  | 0.0015  |
| `radio_rssi`              | Team radio signal strength            | dbm           | misc        | periodic      | [-70, -40]      | 0.02  | 0.0005  |
| `radio_ptt`               | Radio push-to-talk                    | angle_int     | misc        | step_events   | [0, 1]          | 0.03  | 0.001   |
| `pit_radio_flag`          | Pit radio message flag                | angle_int     | misc        | step_events   | [0, 1]          | 0.025 | 0.002   |
| `dash_page`               | Dash page                             | angle_int     | misc        | step_events   | [0, 5]          | 0.01  | 0.0005  |
| `cockpit_temp`            | Cockpit air temperature               | temperature   | misc        | slow_drift    | [30, 45]        | 0.01  | 0.0015  |
| `camera_temp`             | Onboard camera temperature            | temperature   | misc        | slow_drift    | [35, 60]        | 0.02  | 0.001   |
| `fire_ext_pressure`       | Fire extinguisher bottle pressure     | pressure      | misc        | flat_noisy    | [22, 26]        | 0.015 | 0.002   |
| `logger_cpu_load`         | Data logger CPU load                  | percent       | misc        | flat_noisy    | [0.15, 0.45]    | 0.02  | 0.001   |
