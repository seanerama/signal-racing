import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { DEMO_SPEED, DEMO_TIMEOUT_MS, playGuidedDemo } from './demo-path';

/**
 * Pipeline test for the offline single-file build: `dist-single/signal.html` opened from `file://`,
 * offline, with no server. Proves the inlined worker, CSS and fonts work and that the page
 * makes zero requests other than file:/data:/blob:.
 */
const SINGLE = resolve(process.cwd(), 'dist-single/signal.html');
const ALLOWED = /^(file|data|blob):/;

test.describe('single-file build from file://', () => {
  test.beforeAll(() => {
    if (!existsSync(SINGLE)) {
      throw new Error(`${SINGLE} is missing: run \`npm run build:single\` first`);
    }
  });

  test('worker ping works offline with no external requests', async ({ page, context }) => {
    const requests: string[] = [];
    context.on('request', (r) => requests.push(r.url()));
    page.on('worker', (w) => requests.push(`worker:${w.url()}`));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await context.setOffline(true);

    await page.goto(`${pathToFileURL(SINGLE).href}#/dev/worker`);
    await expect(page.getByTestId('worker-status')).toHaveText('pong');
    await expect(page.getByTestId('topbar')).toBeVisible();

    const external = requests.map((u) => u.replace(/^worker:/, '')).filter((u) => !ALLOWED.test(u));
    expect(external, `external requests: ${external.join(', ')}`).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('fonts render from the inlined data', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto(`${pathToFileURL(SINGLE).href}#/dev`);
    await expect(page.getByTestId('sample-speed')).toBeVisible();
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      // Force-load every face the app declares.
      await Promise.all([
        document.fonts.load('400 12px "JetBrains Mono"'),
        document.fonts.load('500 12px "JetBrains Mono"'),
        document.fonts.load('600 12px "JetBrains Mono"'),
        document.fonts.load('400 15px "DM Sans"'),
        document.fonts.load('500 15px "DM Sans"'),
        document.fonts.load('700 15px "DM Sans"'),
        document.fonts.load('italic 400 15px "DM Sans"'),
        document.fonts.load('600 34px "Barlow Condensed"'),
        document.fonts.load('700 64px "Barlow Condensed"'),
      ]);
      return [...document.fonts]
        .filter((f) => f.status === 'loaded')
        .map((f) => `${f.family.replace(/"/g, '')} ${f.weight}${f.style === 'italic' ? 'i' : ''}`)
        .sort();
    });
    expect(loaded).toEqual([
      'Barlow Condensed 600',
      'Barlow Condensed 700',
      'DM Sans 400',
      'DM Sans 400i',
      'DM Sans 500',
      'DM Sans 700',
      'JetBrains Mono 400',
      'JetBrains Mono 500',
      'JetBrains Mono 600',
    ]);
  });
});

test.describe('guided demo on the single-file build, offline', () => {
  test('the Model page renders offline (MathML, car table, sources as text)', async ({
    page,
    context,
  }) => {
    await context.setOffline(true);
    await page.goto(`${pathToFileURL(SINGLE).href}#/model`);
    const model = page.getByTestId('model-page');
    await expect(model).toBeVisible();
    expect(await model.locator('math').count()).toBeGreaterThanOrEqual(20);
    await expect(page.getByTestId('car-table').locator('tbody tr')).toHaveCount(26);
    await expect(page.getByTestId('sources')).toContainText('https://');
  });

  test('offline check: A1 runs from file:// offline', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto(`${pathToFileURL(SINGLE).href}?playback=instant#/level/A1`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByTestId('begin').click();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('rh-time')).toHaveText(/^\d+\.\d{3}/, { timeout: 30_000 });
  });

  test('the signal.md demo path from file:// with the network blocked', async ({
    page,
    context,
  }) => {
    test.setTimeout(DEMO_TIMEOUT_MS);
    const blocked: string[] = [];
    // Block everything but file:, data: and blob: (the stage brief's network rule).
    await context.route('**', (route) => {
      const url = route.request().url();
      if (ALLOWED.test(url)) return route.continue();
      blocked.push(url);
      return route.abort();
    });
    await context.setOffline(true);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const t0 = Date.now();
    await playGuidedDemo(page, {
      url: `${pathToFileURL(SINGLE).href}?demo=1#/level/B4L`,
      suffix: '-single',
    });
    console.log(`[guided demo] single-file build at ${DEMO_SPEED}×: ${Date.now() - t0} ms wall`);
    expect(blocked, `blocked requests: ${blocked.join(', ')}`).toEqual([]);
    expect(errors).toEqual([]);
  });
});
