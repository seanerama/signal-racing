import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 5 Pipeline Test (browser): on `/#/dev/worker`, "grid A2 + run optimum" runs
 * createSimClient() → gridSearch('A2') → run(optimum.setup) → startLevel session → recordResult
 * in the real sim worker and prints JSON. Also checks the < 1 s grid budget for A2 and that the
 * grid timing is logged at debug level.
 */
interface PipelineReport {
  grid: {
    ms: number;
    wallMs: number;
    evaluated: number;
    target: number;
    optimum: { totalTime: number };
  };
  directRun: { totalTime: number; n: number };
  session: {
    runTime: number;
    passes: boolean;
    status: string;
    score: number;
    runsUsed: number;
    hints: string[];
  };
  progress: { passed: boolean; bestScore: number; attempts: number } | null;
}

async function runPipeline(page: Page): Promise<PipelineReport> {
  await page.getByRole('button', { name: 'grid A2 + run optimum' }).click();
  const pre = page.getByTestId('worker-pipeline');
  await expect(pre).toBeVisible({ timeout: 30_000 });
  return JSON.parse((await pre.textContent()) ?? '') as PipelineReport;
}

function expectPassing(r: PipelineReport): void {
  expect(r.grid.evaluated).toBe(176);
  expect(r.directRun.totalTime).toBeLessThanOrEqual(r.grid.target);
  expect(r.directRun.n).toBeGreaterThan(100);
  expect(r.session.passes).toBe(true);
  expect(r.session.status).toBe('passed');
  expect(r.session.runsUsed).toBe(1);
  expect(r.session.score).toBe(5);
  expect(r.session.hints).toEqual([]);
  expect(r.progress).toMatchObject({ passed: true, bestScore: 5, attempts: 1 });
}

test('pipeline: grid A2 + run optimum passes and persists a score (vite preview)', async ({
  page,
}) => {
  const debugLines: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'debug') debugLines.push(m.text());
  });
  await page.goto('/?debug#/dev/worker');
  await expect(page.getByTestId('worker-status')).toHaveText('pong');
  const report = await runPipeline(page);
  expectPassing(report);
  console.log(
    `[stage-5 pipeline] browser grid A2: ${report.grid.ms} ms in worker, ${report.grid.wallMs} ms wall, ${report.grid.evaluated} setups`,
  );
  expect(report.grid.ms).toBeLessThan(1000);
  expect(debugLines.some((l) => /grid search A2: \d+ ms, 176 setups/.test(l))).toBe(true);
  // Progress survives a reload.
  await page.reload();
  const stored = await page.evaluate(() => localStorage.getItem('signal.v1.progress'));
  expect(JSON.parse(stored ?? '{}')).toMatchObject({
    v: 1,
    data: { A2: { passed: true, bestScore: 5 } },
  });
});

test('pipeline also runs in the single-file build from file:// (offline)', async ({
  page,
  context,
}) => {
  const single = resolve(process.cwd(), 'dist-single/signal.html');
  test.skip(!existsSync(single), 'dist-single/signal.html not built');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.setOffline(true);
  await page.goto(`${pathToFileURL(single).href}#/dev/worker`);
  await expect(page.getByTestId('worker-status')).toHaveText('pong');
  expectPassing(await runPipeline(page));
  expect(errors).toEqual([]);
});
