import { defineConfig, devices } from '@playwright/test';

/** `PW_PORT` lets a second checkout run its suite alongside (e.g. 4180) without a port clash. */
const PORT = Number(process.env['PW_PORT'] ?? 4173);

/**
 * E2E. `npm run test:e2e` builds `dist/` and `dist-single/` first, then:
 * - smoke.spec.ts runs against `vite preview` (the webServer below);
 * - single-file.spec.ts opens `dist-single/signal.html` from `file://` (no server).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
