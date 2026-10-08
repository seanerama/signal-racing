import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.shared.ts';

/** Standard build: `npm run build` → `dist/` (worker emitted as its own chunk). */
export default defineConfig(
  mergeConfig(baseConfig({ singleFile: false }), {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // dist/.vite/manifest.json: tests/e2e/bundle.spec.ts checks three.js stays out of the
      // initial chunk.
      manifest: true,
      rolldownOptions: {
        output: {
          // three.js (+ its addons) as its own lazily loaded chunk, named so the manifest and
          // network panel read plainly. Only `src/viz3d` reaches it, through dynamic import().
          codeSplitting: {
            groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
          },
        },
      },
      // The three chunk is ~590 kB (≈150 kB gzipped) and never on the initial path.
      chunkSizeWarningLimit: 700,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  }),
);
