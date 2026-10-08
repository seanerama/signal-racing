# Signal — Telemetry Racing Game Spec

Oct 7, 2026 · @Sean Mahoney

## Concept

Signal is a racing game with nothing on screen but data. The car exists only as a physics model that produces telemetry, and the player's only window into it is the data.

Each level introduces one physical effect (drag, grip, load transfer, cornering, balance, tire temperature, track conditions, fuel) and unlocks one or two setup levers. The player sets the car up, runs it, reads the telemetry, adjusts, and runs again. The objective never changes: a faster time in fewer runs.

The skill the game teaches is not driving or setup. It is knowing which of the many telemetry channels to look at for the question in front of you. That is the problem Chip Ganassi Racing and OpenAI describe in their R&D series, reduced to something playable in ten minutes.

The game has two phases. First, segments: a straight, a corner, a straight with a stop, each tuned on its own with one lever at a time. Then assembly: those segments are joined one by one into a track, and one setup has to serve all of them at once.

The final level, The Puzzle, is the article's premise as a game: the fully assembled track, every lever, ten practice runs, two hundred channels, and an optional assist that ranks which channels matter. Working title only; see Open questions.

## Design principles

Six rules decide every design question below.

1. **One concept per level.** Each level adds exactly one physical effect and one or two levers. Everything else is held constant, so a change in the data has one cause.
2. **Telemetry is the only feedback.** No animation, no track map, no car. Stacked line graphs on one shared time axis, and the numbers behind them.
3. **Channels grow faster than useful channels.** Every level adds real-but-irrelevant sensors. The ratio of signal to total falls from roughly 1 in 4 at level 1 to 1 in 30 at the end. Learning to ignore is the skill.
4. **Hints teach reading, not answers.** A hint names the channel that matters and what it is showing. It never says "set the wing to 4."
5. **Physics is minimal and honest.** Every equation fits on one line and can be explained in one sentence. Tradeoffs are never scripted; they fall out of the model.
6. **Runs are the currency.** Each level allots a fixed number of runs. Fewer runs to target is a better score, and hints cost runs.

## Core loop

A level is a loop of set, run, read, adjust, repeated until the target time is hit or the run budget is spent.

1. **Brief.** The level names its concept, the levers unlocked, the run budget, and the target time.
2. **Set.** The player sets the unlocked levers. Locked levers are shown greyed at their fixed values, so the car's full setup is always visible.
3. **Run.** The engine simulates the segment or lap at a fixed 10 ms timestep and logs every channel.
4. **Read.** The run report shows the result (time, delta to best, delta to target), the setup used, and the stacked graphs: each channel as a strip on one time axis, this run drawn over the best run.
5. **Hint (optional).** The player opens a hint. Each tier costs one run.
6. **Adjust and repeat.**
7. **Debrief.** On pass or exhaustion: the channels that mattered, the physics in two sentences, the optimal setup, and the player's run-by-run convergence.

## Physics engine

The car is one rigid body moving along a 1-D path, with a four-corner load model deciding how much grip each tire has. That is enough to make every lever in the game produce a real tradeoff.

**Model.** The track is a list of segments: straights (length) and corners (radius, arc length). State is position along the path and speed. Forces are longitudinal (engine, brakes, drag, rolling) and lateral (the centripetal demand of the corner). Weight plus downforce plus load transfer is split across four tires, and each tire has a grip budget it cannot exceed.

**Longitudinal motion.** Newton's second law along the path, with drag growing as the square of speed.

```latex
m\,\dot v = F_x - \tfrac{1}{2}\rho C_d A v^2 - C_{rr}\, m g
```

**Engine.** Torque-limited at low speed, power-limited above it. Throttle scales the result.

```latex
F_{engine}(v) = \theta \cdot \min\!\left(F_{peak},\; P / v\right)
```

**Downforce and the aero tradeoff.** The wing setting raises lift linearly and drag quadratically, so the sweet spot moves with the length of the straights.

```latex
F_{down} = \tfrac{1}{2}\rho C_l A v^2, \qquad C_l = C_{l0} + k_l w, \qquad C_d = C_{d0} + k_d w^2
```

**Grip budget per tire.** Friction coefficient times vertical load. This one line is the whole game.

```latex
F_{max,i} = \mu_i N_i
```

**Tire load sensitivity.** Grip rises with load but less than proportionally. This is the term that makes weight transfer matter: the tire that gains load gains less grip than the tire that loses load gives up, so moving load across an axle lowers that axle's total grip. Without it, the weight-distribution and balance levels have no lesson.

```latex
\mu_i = \mu_0 \left(1 - k_s \frac{N_i - N_{ref}}{N_{ref}}\right)
```

**Friction circle.** Longitudinal and lateral force share the budget.

```latex
\sqrt{F_{x,i}^2 + F_{y,i}^2} \le \mu_i N_i
```

**Static load.** Set by the weight-distribution lever d (fraction on the rear axle) and the aero balance.

```latex
N_{front} = (1-d)\, m g + (1-b)\, F_{down}, \qquad N_{rear} = d\, m g + b\, F_{down}
```

**Longitudinal load transfer.** Acceleration moves load to the rear, braking to the front. Centre-of-gravity height over wheelbase sets how much.

```latex
\Delta N_{long} = m\, a_x\, h / L
```

**Lateral load transfer and balance.** Cornering moves load to the outside tires. The anti-roll-bar lever q decides what share of that transfer the front axle takes; the rest goes to the rear. Because of load sensitivity, the axle that takes more transfer loses more grip. Front first is understeer, rear first is oversteer.

```latex
\Delta N_{lat} = m\, a_y\, h / t, \qquad \Delta N_{front} = q\,\Delta N_{lat}, \qquad \Delta N_{rear} = (1-q)\,\Delta N_{lat}
```

**Corner speed limit.** The fastest speed through a corner of radius r is where lateral demand meets the weaker axle's budget. Downforce raises it, which is why the wing is worth drag on a twisty track.

```latex
m\, v^2 / r \le \min(F_{y,front}^{max},\; F_{y,rear}^{max}) \cdot 2
```

**Wheelspin and lock.** When demanded force on an axle exceeds its budget, the tires slide: slip ratio rises, usable force drops to about 0.8 of peak, and heat spikes. Telemetry shows this as wheel speed diverging from ground speed.

**Tire temperature.** Heat in from grip used, heat out to the track. Grip peaks at an optimum temperature and falls either side.

```latex
\dot T = k_{heat}\, (F_{used}/F_{max})^2\, v - k_{cool}\,(T - T_{track}), \qquad \mu_0(T) = \mu_{peak}\, e^{-\left((T - T_{opt})/\sigma\right)^2}
```

**Wear and fuel.** Wear accumulates with heat input and lowers peak grip linearly. Fuel burns with throttle-time, so the car gets lighter through a stint.

**Track conditions.** A track temperature and a grip multiplier (dry 1.0, damp 0.7, wet 0.5), plus from level 7 a ±1% random variation per run, so the player learns to tell a setup change from noise.

**Driver model.** The player does not drive. A simple driver holds full throttle on straights, brakes at the latest point that reaches the corner's limit speed, holds that speed through the corner, and accelerates out. Where the car is traction-limited the driver uses only the throttle the tires can take, unless the throttle-ramp lever is unlocked, in which case the player chooses and may overshoot.

**Default car.** Round numbers in the neighbourhood of an IndyCar, labelled approximate; the game does not claim to model any real car.

| Parameter | Value |
| --- | --- |
| Mass with driver, m | 750 kg |
| Power, P | 500 kW |
| Peak tractive force, F\_peak | 5.8 kN (tuned so the launch sits between static and transferred rear grip; see A2) |
| Drag area at mid wing, C\_d·A | 1.0 m² |
| Lift area at mid wing, C\_l·A | 3.0 m² |
| Peak friction, μ\_peak | 1.6 |
| Load sensitivity, k\_s | 0.1 per 100% load change |
| CoG height, h | 0.30 m |
| Wheelbase, L | 3.0 m |
| Track width, t | 1.9 m |
| Optimum tire temp, T\_opt | 90 °C, σ = 25 °C |
| Timestep | 10 ms (100 Hz logging) |

## Telemetry

Every channel in the game is real in the sense that the engine computes it or a plausible sensor would report it. What changes level to level is how many channels there are and how few of them answer the level's question.

**Channel taxonomy.** Each channel is tagged per level with one of five roles. The tag is hidden from the player and used by the hint engine, the debrief, and the final-level assist.

| Role | What it is | Examples |
| --- | --- | --- |
| Outcome | What the player is trying to improve | segment time, sector times, lap time, top speed, delta to best |
| Causal | Directly reveals the effect of this level's lever | rear slip ratio (L2), per-axle load (L3), lateral g (L4), tire temp (L6) |
| Correlated | Moves with the causal channels but does not explain them | engine RPM, gear, wheel speed when there is no slip |
| Distractor | A real sensor with no bearing on this level | oil temp, oil pressure, water temp, battery voltage, fuel pressure, gearbox temp, GPS altitude, ambient pressure, radio signal strength, steering torque on a straight |
| Noise | Sensor noise and dropouts on every channel | Gaussian noise at 1 to 3% of range; occasional dropout samples |

A channel's role can change between levels. Brake temperature is a distractor until braking is unlocked, then becomes causal. That is the realistic case and reinforces the lesson that relevance depends on the question.

**Growth.** Roughly 12 channels at level 1 with 3 that matter, 20 at level 2 with 4, 40 by level 4, 80 by level 6, and about 200 in The Puzzle with 6 to 8 that matter. The exact counts are tuned in playtesting; the direction is the design.

**Stacked graphs.** The run report is a stack of line graphs, one strip per channel, all on one horizontal axis: time since the start of the current segment. The best run so far is drawn under this run on every strip, so a difference shows as a gap between two lines at the same instant. A header above the stack carries the result and the setup used.

&#91;embedded content: run report mockup · 4 strips, one time axis\]

A vertical cursor reads every strip at the same instant, which is how a player sees wheelspin as a slip spike, a dip in acceleration, and a heat rise all at once. A hint that cites a time window shades that window on the strip it names.

**Strips.** The player adds, removes and reorders strips from the channel list, and the arrangement persists between runs so a view built on level 2 is still there on level 9. Each level opens with a default stack of four to six strips chosen from the outcome and correlated roles, never the causal ones. Finding the causal strip and pulling it into the stack is the move the game rewards.

**Channel list.** Beside the stack, every channel in a scrollable table with min, max and mean for this run and the best run. The table is where distractors live until the player learns to leave them there.

**Assembly view.** In the assembly levels the axis spans the whole joined track, segment boundaries are marked as vertical rules, and a strip labelled segment\_delta shows time lost against each segment's isolated best. That strip is how the player sees which segment is paying for the compromise.

**Export.** Every run's telemetry downloads as a CSV with one column per channel. Opening a Puzzle run in a spreadsheet, two hundred columns wide, makes the article's point without a word.

## Hint engine

Hints are rule-based diagnostics computed from the run just completed. They come in three tiers, each costing one run, and they always point at a channel before they point at a lever.

| Tier | What it gives | Example (level 2, wheelspin) |
| --- | --- | --- |
| 1 Observe | The channel and the pattern | rear\_slip\_ratio peaked at 0.18 between 0.3 s and 1.1 s. |
| 2 Explain | The physics behind the pattern | Slip ratio above about 0.10 means the driven tires are spinning faster than the car is moving. Sliding rubber makes less force than gripping rubber, so acceleration fell while the engine made full power. |
| 3 Direct | The lever and the direction, never the value | Lower the throttle ramp until peak slip ratio stays under 0.10. |

**Rule format.** Each level declares its hint rules as a condition over the run's channel summaries plus three tier texts. Rules can fire on faults (something went wrong) or on headroom (something was left on the table).

```markdown
when: max(rear_slip_ratio) > 0.10
  tier1: "rear_slip_ratio peaked at {max} between {t_start} s and {t_end} s."
  tier2: "..."
  tier3: "Lower the throttle ramp until peak slip ratio stays under 0.10."

when: top_speed reached before 80% of straight AND wing > 2
  tier1: "speed flattened at {top_speed} km/h with {remaining} m of straight left."
  tier2: "Thrust equals drag at that speed. Drag grows with the square of speed and with the wing setting."
  tier3: "Lower the wing until speed is still rising at the end of the straight."
```

**Rules that fire together.** When two rules fire, the engine shows the one with the larger estimated time cost first. The debrief shows every rule that fired on every run, all three tiers, free.

**Noise rule.** From level 7, a rule fires when the delta between two runs is within the run-to-run noise band: "This change is smaller than the track variation between runs. Compare runs under like conditions before concluding." This is the hint most players need and least expect.

## Level progression

Eleven levels in two phases. Phase A tunes single segments in isolation, one effect and one lever at a time. Phase B joins those segments one by one into a track, under a single setup that must serve all of them. Every level keeps the levers of the levels before it and raises the channel count.

| # | Level | New effect | New lever(s) | Key channel(s) | Segment or track | Runs |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Throttle | Drag, F = ma | Throttle ramp | speed, long\_g, drag\_force | 1 km straight from standstill | 5 |
| A2 | Grip | Traction limit | Tire pressure (ramp now matters) | rear\_slip\_ratio, wheel speed vs ground speed | Same straight | 6 |
| A3 | Weight | Longitudinal load transfer | Weight distribution | load\_front, load\_rear, front\_slip, rear\_slip | 1 km launch, brake to a stop | 6 |
| A4 | Corner | Friction circle, aero tradeoff | Wing angle | lat\_g, corner\_min\_speed, exit\_speed, downforce | Short run-up, constant-radius corner, short run-out | 7 |
| A5 | Balance | Lateral transfer split | Front and rear anti-roll bar | grip\_used\_front, grip\_used\_rear, yaw\_rate | Same corner | 7 |
| A6 | Heat | Temperature-dependent grip | Tire pressure (re-tuned) | tire\_temp per corner, pass-time trend | Same corner, three passes back to back | 8 |
| A7 | Conditions | Run-to-run variation | None | track\_temp, grip multiplier, delta vs noise band | Same, conditions vary | 8 |
| B1 | Join: straight + fast corner | The aero compromise | All of A1 to A5 | segment\_delta per segment, top\_speed, corner\_min\_speed | Two segments, one setup | 8 |
| B2 | Join: + slow corner | The balance compromise | Same | segment\_delta, grip\_used per axle in each corner | Three segments | 8 |
| B3 | Join: + second straight, run as a stint | Wear and fuel | Fuel load, aggression | fuel\_mass, wear %, lap-time trend | Four segments, 10 laps | 8 |
| B4 | The Puzzle | Everything | All, plus the assist toggle | 6 to 8 of about 200 | The assembled track, conditions vary | 10 |

**Phase A, segments.** Each segment is a few seconds long and the time axis of the graphs spans exactly that. The player's best time on each segment is kept; it becomes the yardstick in Phase B.

**A1, Throttle.** A tutorial on reading the stack with a lever whose answer is obvious. There is no grip limit, so the fastest ramp is always best. The lesson is the graphs themselves: watch long\_g fall as speed rises, watch drag\_force bend upward with the square of speed, and see which of the twelve channels moved when the lever moved. Pass condition is the full-throttle time.

**A2, Grip.** The same straight with the traction limit on. The ramp from A1 now spins the rear tires at low speed, where engine force exceeds μN, and the car is slower despite full power. Tire pressure sets μ on a bell curve around an optimum. The player must find a ramp that keeps rear\_slip\_ratio under its peak and a pressure near the optimum. The key discovery is wheel speed diverging from ground speed on two strips at the same instant.

**A3, Weight.** The car launches, then brakes to a stop before the end of the straight. More static rear weight gives the rear tires more grip for the launch but less front load for braking, and the fronts lock. Brake bias is fixed at 60% front. The player watches load\_front and load\_rear trade places under acceleration and braking and learns the transfer equation from the shape of the lines. This is the first level with a real tradeoff and a true optimum inside the range.

**A4, Corner.** The first lateral load. A short run-up, one constant-radius corner, a short run-out, and the driver brakes to the corner's limit speed automatically. Wing angle buys corner speed through downforce and costs exit speed through drag; on a segment this short the balance tips toward wing, which sets up the surprise in B1. The player reads lat\_g, corner\_min\_speed and exit\_speed across runs.

**A5, Balance.** Same corner. The anti-roll-bar split moves lateral load transfer between axles. Because of load sensitivity, whichever axle takes more transfer runs out of grip first. The player reads grip\_used\_front and grip\_used\_rear on adjacent strips and balances them so both axles reach the limit at the same instant.

**A6, Heat.** The same corner taken three times back to back. Cold tires on the first pass, overheating by the third. Pressure now also sets the heat rate. The player reads tire temperature per corner against the pass-time trend and tunes for all three passes, not the best one.

**A7, Conditions.** The same three passes, but track temperature and grip vary between runs and each run carries ±1% noise. No new lever. The lesson is discipline: compare like with like, and do not chase a gap between two lines that is smaller than the noise. The noise rule in the hint engine fires here.

**Phase B, assembly.** The segments from Phase A are joined one at a time, in an order the level sets, and one setup runs the whole joined track. The player can adjust only the levers that the segments present so far have unlocked. The sum of the player's isolated bests is the floor: no single setup can beat it, and the gap between that sum and the assembled time is the cost of compromise. The segment\_delta strip shows which segment is paying it.

**B1, Join: straight + fast corner.** The A4 wing setting was tuned on a short segment and is now dragging down a kilometre of straight. The player sees the straight's segment\_delta grow while the corner's stays near zero, lowers the wing, and watches the cost move into the corner. The best compromise is where the two deltas are balanced, and the graphs show exactly where that is.

**B2, Join: + slow corner.** A fast corner and a slow corner want different anti-roll-bar splits, and the car gets one. The grip\_used strips for each corner show one axle at the limit in the fast corner and the other in the slow one. The player finds the split that spreads the compromise rather than loading it onto one corner.

**B3, Join: + second straight, as a stint.** Four segments make a lap; the level runs ten. Fuel adds mass but must last, and aggression trades lap time against wear. The time axis now spans a whole lap, with lap-over-lap overlays replacing run-over-run. The fastest lap and the fastest stint are different objectives, and the debrief shows both.

**B4, The Puzzle.** Covered in its own section below.

## Scoring and progression

A level is passed by hitting its target time within the run budget. The score is how many runs were left.

- **Target.** The level's optimum time times a tolerance: 1.0% for A1 to A3, 0.5% from A4. The optimum is computed by grid search over the unlocked levers when the level loads, so targets are always achievable and always consistent with the model.
- **Pass.** Any single run at or under target (A1 to B2). For B3 and The Puzzle, the total stint time.
- **Compromise gap (Phase B).** The assembled time minus the sum of the player's isolated segment bests. Reported per run and per segment. It is the number the assembly levels are about, and the Phase B target is set on it: within 0.5% of the best achievable gap.
- **Score.** Runs remaining at the moment of passing. Each hint tier opened subtracts one. Failing to pass scores zero but still unlocks the debrief and the next level, so nobody is stuck.
- **Debrief.** After pass or exhaustion: the causal channels named and their strips shown across all runs, the physics in two sentences, the optimal setup beside the player's best, and a run-by-run table of the player's convergence.
- **Progression.** Levels unlock in order. Any passed level can be replayed for a better score, and a better segment best in Phase A lowers the floor in Phase B. The Puzzle unlocks after B3 regardless of score.

## The Puzzle and the AI assist

The Puzzle is Ganassi's metaphor as a level: every team arrives with data, experience and tools, and limited practice time, and the question is who puts the puzzle together fastest. It is also the last assembly step, and the only one where the player has seen every piece before.

**Setup.** The track assembled through B1 to B3, plus two segments the player has not tuned in isolation (a long fast corner and a chicane), so there is no floor to lean on for part of the lap. Every lever: throttle ramp, tire pressure, weight distribution, wing, front and rear anti-roll bar, fuel load, aggression. Conditions vary between runs. Ten runs. About 200 channels, of which six to eight are causal. Target is within 0.5% of the optimum stint.

**The assist.** A toggle, off by default. When on, after each run it shows the five channels most correlated with lap time across the runs so far, with the sign of the correlation and a one-line reason drawn from the hint rules that fired. It never sets a lever and never names a value.

**What it is.** Deliberately simple and fully explainable: a rank by absolute correlation with the outcome, plus the same rules that produced hints in levels 1 to 8 acting as priors. That is the point for the meeting. It is a filter, not a decider, which is exactly how the article frames OpenAI's role: surface what matters so the engineer applies their judgment faster.

**What it is not.** Not a model of the car, not a setup optimiser, not a black box. With ten runs and 200 channels, raw correlation alone finds plenty of spurious matches. The priors are what make it useful, and the debrief says so.

**The comparison.** The debrief reports runs-to-target with and without the assist, from the player's own history. A player who has done the earlier levels will usually converge in six to eight runs unassisted and four to five assisted. Those two numbers are the demo.

**The meeting demo, in two minutes.** Open The Puzzle. Run once with everything at defaults. Scroll the 200-channel report. Open a run's CSV in a spreadsheet so the width is visible. Turn the assist on, run again, and show the five channels it surfaces. Then ask the CIO which five their engineers would have picked.

## Architecture

One HTML file with vanilla JavaScript and no build step, so it runs offline on a laptop in the meeting.

&#91;embedded content: architecture · 8 modules, one data path\]

Level config shapes what the setup form offers and what the engine simulates. The engine produces one telemetry stream, and the report, hints, assist and store all read from it. The player reads the report and goes back to the setup form; that loop is the game.

- **The engine is a pure function.** Car, setup, track, conditions and a seed go in; telemetry rows and a channel summary come out. No state. That is what makes the target search and the assist cheap to run.
- **Determinism.** A seeded random generator, so a run reproduces exactly from its seed. Levels 7 and up vary the seed per run.
- **Targets by search.** At level load, a grid search over the unlocked levers finds the optimum. A run is about 6,000 steps; five levers at six points each is 7,776 runs, well under a second in a web worker.
- **Level config is data.** Track, lever ranges and defaults, channel roles, hint rules and run budget live in a JSON object per level. Adding a level means adding a config, not code.
- **Channel registry.** Each channel declares its name, unit, how it is computed (from engine state or a distractor generator), its noise level, and its role per level.
- **Storage.** Run history lives in memory for the session. Scores persist in browser storage as a convenience and nothing depends on them.

## Build plan

Four milestones, and the meeting needs the first and a rough cut of the last.

1. **Straight line (A1 to A3) and the stack.** Engine with drag, engine curve, traction limit, longitudinal load transfer. The stacked-graph report with this-run-over-best overlay, cursor and strip management. Hint engine with the A1 to A3 rules. Grid-search targets. This is the minimum that teaches something.
2. **Corners (A4 to A7).** Segment tracks, the driver model's braking and corner-speed logic, lateral load transfer and the anti-roll-bar split, the wing tradeoff, temperature, per-run condition variation and the noise rule.
3. **Assembly (B1 to B3).** Joining segments, one setup across them, the segment\_delta strip and the compromise gap, segment boundaries on the axis, multi-lap runs with fuel and wear.
4. **The Puzzle and the assist.** The two unseen segments, the 200-channel registry, the correlation ranker with priors, CSV export, the with-and-without comparison in the debrief.

**Before the meeting.** Milestone 1 complete, plus a rough join of two straight segments to show the compromise gap, plus The Puzzle running on that engine with a padded channel list. The demo needs the stack, the wall of channels, the assist toggle and one CSV; it does not need corners to make its point.

- [ ] Milestone 1: engine, stacked graphs, hints, A1 to A3
- [ ] Rough join: two segments, one setup, segment\_delta strip
- [ ] Rough Puzzle: wide channel list, assist toggle, CSV export
- [ ] Playtest once with someone who has not seen the spec
- [ ] Milestones 2 to 4 after the meeting

## Open questions

- [ ] **Name.** Signal is a working title. Alternatives: Pace, Setup Sheet, The Puzzle.
- [ ] **Driver as a lever.** Levels 1 to 7 use an always-optimal driver. Should braking point be a player lever earlier, or stay out until aggression appears in level 8?
- [ ] **Units.** The spec uses metric (km/h, °C, kg). IndyCar teams work in mph and °F. Pick before building the channel registry; switching later touches every label.
- [ ] **Distractor difficulty.** Purely irrelevant sensors, or sensors that graduate to causal in later levels (brake temperature, oil temperature under a long stint)? The spec recommends graduation; it is more realistic and reinforces the lesson.
- [ ] **Hint cost.** One run per tier may be too steep at five-run levels. An alternative is free tier 1, one run for tiers 2 and 3.
- [ ] **The assist's priors.** How much weight the hint rules get against raw correlation decides whether the assist looks magical or honest. Start with rules first, correlation as tie-breaker, and tune in playtest.

* [ ] **Segment order in Phase B.** The spec has the level fix the order. Letting the player choose which segment to add next is more puzzle-like but makes targets harder to compute and compare.
* [ ] **Locked levers between joins.** Should some levers lock once a segment is joined (weight distribution and fuel, say, as things a team cannot change between sessions), or stay free until The Puzzle? Locking is more realistic; free is easier to learn from.
* [ ] **Time or distance on the x-axis.** Time is what the spec says and what a driver feels. Distance is what engineers overlay laps on, because a slower run stretches in time and the corners stop lining up. Distance is probably right from B1 onward.

