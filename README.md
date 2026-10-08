# Signal

A racing game that shows nothing on screen but data. You tune a car's setup using only stacked
telemetry graphs. `signal.md` is the game design spec.

## Quick start

Requires Node ≥ 22.12 and npm ≥ 10.

```sh
npm i              # installs from the committed package-lock.json
npm run dev        # http://localhost:5173
npm run check      # typecheck + lint + unit tests (must pass before any stage merges)
```

## Scripts

| Script                 | What it does                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server                                                                       |
| `npm run precompute`   | Grid-search every level → `src/game/precomputed-targets.json` (runs as `prebuild`)    |
| `npm run build`        | Static build → `dist/` (serve with `npm run preview`)                                 |
| `npm run build:single` | Meeting fallback → `dist-single/signal.html`, one self-contained file for `file://`   |
| `npm run preview`      | Serves `dist/` on port 4173                                                           |
| `npm run typecheck`    | `tsc --noEmit` for the app (`tsconfig.json`) and tests/configs (`tsconfig.node.json`) |
| `npm run lint`         | ESLint (typescript-eslint type-checked + import boundaries)                           |
| `npm run test`         | Vitest (node for `*.test.ts`, jsdom for `*.dom.test.tsx`)                             |
| `npm run test:slow`    | Recomputes the precomputed targets and compares them bit-for-bit                      |
| `npm run test:e2e`     | Builds both artifacts, then Playwright (incl. the meeting demo on both builds)        |
| `npm run check`        | typecheck + lint + test                                                               |
| `npm run format`       | Prettier                                                                              |

First e2e run: `npx playwright install chromium`.

Dev route `#/dev/worker` pings the sim worker and shows the round-trip time; "live grid B4L"
times the worker search the game falls back to when a level has no precomputed target.

## The meeting demo (v0.3.0)

Levels: A1–A4 (Phase A), B1L "Join: straight + fast corner" and B4L "The Puzzle" (Phase B).

Open `signal.html?demo=1#/level/B4L` (or `npm run preview` and `/?demo=1#/level/B4L`). The
`DEMO PROFILE` chip shows while the profile is active: every level is unlocked and a recorded
unassisted Puzzle attempt (`src/app/demo-history.json`: setups and seeds only) is re-simulated on
load, so the debrief's with/without-assist comparison exists on a fresh laptop. Then: run at the
defaults, scroll the channel table (223 channels), Export CSV, switch the assist on, run again.
After run 2 the MAKE THE CALL panel asks about a planted one-sample `speed_diff_rl` spike (flag it
and cross-check); the grip circle sits under the track view; `#/model` (ⓘ menu, level-select
footer, debrief) documents every equation, the car and the sources. `tests/e2e/demo.spec.ts` and `tests/e2e/single-file.spec.ts` play exactly this path.
`docs/playtest.md` is the observer's note for a first playtest.

Independent educational prototype. Not affiliated with any racing team or company. The car is
approximate and does not model any real vehicle.

## Layout and rules

- `src/engine/` is pure and may import only from `src/engine/`.
- `src/{telemetry,levels,hints,assist,game,units,export}/` never import UI packages (preact,
  @preact/signals, uplot, three) or UI dirs (`report`, `setup`, `app`, `debrief`, `viz3d`), except
  the logger `@/app/log`.
- Both rules are lint-enforced (`eslint.config.js`) and proven by `tests/lint/boundaries.test.ts`.
- SI units everywhere; `src/units/` converts at the display edge.
- Design tokens live in `src/styles/tokens.css`; components never use raw hex.
- Fonts (JetBrains Mono, Inter; SIL OFL 1.1, licences beside them) are self-hosted in
  `src/assets/fonts/`.

## Worker builds

`src/worker/spawn.ts` imports the alias `@sim-worker`, which `vite.shared.ts` maps to
`sim.worker.ts?worker` (standard build) or `sim.worker.ts?worker&inline` (single-file build). That
is the only difference between the two builds. Bundled workers are classic (IIFE) because a module
worker from a `blob:` URL is refused under `file://`.

## Dependency note

npm 10's resolver crashes (`Cannot read properties of null (reading 'edgesOut')`) when it has to
build a fresh tree containing vitest ≥ 4.1.11. Installing from the committed lockfile works on
npm 10 (`npm i` or `npm ci`). To change dependencies, regenerate the lockfile with npm 11:
`npx npm@11 install`.
