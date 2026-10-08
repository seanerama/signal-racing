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
| `npm run build`        | Static build → `dist/` (serve with `npm run preview`)                                 |
| `npm run build:single` | Meeting fallback → `dist-single/signal.html`, one self-contained file for `file://`   |
| `npm run preview`      | Serves `dist/` on port 4173                                                           |
| `npm run typecheck`    | `tsc --noEmit` for the app (`tsconfig.json`) and tests/configs (`tsconfig.node.json`) |
| `npm run lint`         | ESLint (typescript-eslint type-checked + import boundaries)                           |
| `npm run test`         | Vitest (node for `*.test.ts`, jsdom for `*.dom.test.tsx`)                             |
| `npm run test:e2e`     | Builds both artifacts, then Playwright (smoke + single-file from `file://`)           |
| `npm run check`        | typecheck + lint + test                                                               |
| `npm run format`       | Prettier                                                                              |

First e2e run: `npx playwright install chromium`.

Dev route `#/dev/worker` pings the sim worker and shows the round-trip time.

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
