import { defineConfig, mergeConfig } from 'vite';
import { baseConfig } from './vite.shared.ts';

/** Standard build: `npm run build` → `dist/` (worker emitted as its own chunk). */
export default defineConfig(
  mergeConfig(baseConfig({ singleFile: false }), {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  }),
);
