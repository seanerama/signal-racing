/**
 * Config shared by the standard build (`vite.config.ts`), the single-file build
 * (`vite.single.config.ts`) and Vitest.
 *
 * The ONLY difference between the two builds is how the sim worker is imported:
 * `src/worker/spawn.ts` imports the virtual specifier `@sim-worker`, which this alias maps to
 * `sim.worker.ts?worker` (a separate chunk) or `sim.worker.ts?worker&inline` (embedded as a
 * blob/data URL so `dist-single/signal.html` works from `file://`).
 */
import { fileURLToPath, URL } from 'node:url';
import preact from '@preact/preset-vite';
import type { UserConfig } from 'vite';

export const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const workerEntry = fileURLToPath(new URL('./src/worker/sim.worker.ts', import.meta.url));

export function baseConfig(opts: { singleFile: boolean }): UserConfig {
  const workerQuery = opts.singleFile ? '?worker&inline' : '?worker';
  return {
    base: './',
    plugins: [preact()],
    resolve: {
      alias: [
        { find: /^@sim-worker$/, replacement: `${workerEntry}${workerQuery}` },
        { find: /^@\//, replacement: `${srcDir}/` },
      ],
    },
    worker: {
      // Bundled workers are classic (IIFE), in BOTH builds so the worker import stays the only
      // difference between them. Reason: from `file://` the page has an opaque origin, and Chrome
      // refuses a `{ type: 'module' }` worker from a `blob:null/…` URL (asynchronously, so Vite's
      // data-URL fallback never runs). A classic blob worker loads fine. The source is still an
      // ES module, and `vite dev` still serves it as a module worker. The cost: no code-splitting
      // or dynamic import() inside the worker, which the engine does not need.
      format: 'iife',
    },
  };
}
