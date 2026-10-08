import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from './vite.shared.ts';

/**
 * Two projects: `*.dom.test.tsx` runs in jsdom, everything else in node.
 * Playwright specs (`tests/e2e/*.spec.ts`) are not matched here.
 */
export default mergeConfig(
  baseConfig({ singleFile: false }),
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: ['tests/**/*.dom.test.tsx', 'src/**/*.dom.test.tsx'],
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/types.ts', 'src/**/*.d.ts'],
        reporter: ['text', 'html'],
      },
    },
  }),
);
