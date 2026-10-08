import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from './vite.shared.ts';

/**
 * `npm run test:slow`: tests that recompute expensive artefacts (the precomputed grid-search
 * targets, ~5 s of search). Not part of `npm test` / `npm run check`.
 */
export default mergeConfig(
  baseConfig({ singleFile: false }),
  defineConfig({
    test: {
      environment: 'node',
      include: ['tests/**/*.slow.test.ts'],
      testTimeout: 300_000,
    },
  }),
);
