import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Stage 7: the 3D data views on `/#/dev/viz3d` (A2 through the real sim worker: grid search plus
 * five player runs). Screenshots for the visual check go to test-results/stage-7/.
 */

const SHOTS = 'test-results/stage-7';

/** Console noise that is not ours: SwiftShader's driver performance notes. */
const IGNORED = /GPU stall due to ReadPixels|GL Driver Message/;

function collectConsole(page: Page) {
  const errors: string[] = [];
  const contextWarnings: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m: ConsoleMessage) => {
    const text = m.text();
    if (IGNORED.test(text)) return;
    if (m.type() === 'error') errors.push(text);
    if (/context/i.test(text) && /webgl|three/i.test(text)) contextWarnings.push(text);
    if (/too many active webgl contexts/i.test(text)) contextWarnings.push(text);
  });
  return { errors, contextWarnings };
}

async function openDev(page: Page, url = '/#/dev/viz3d') {
  await page.goto(url);
  await expect(page.getByTestId('viz3d-status')).toContainText('5 runs', { timeout: 30_000 });
}

async function openWaterfallFromGutter(page: Page, channel: string) {
  const gutter = page.locator(`[data-strip-gutter="${channel}"]`);
  await gutter.hover();
  await gutter.getByRole('button', { name: `${channel} strip menu` }).click();
  await page.getByRole('menuitem', { name: 'Waterfall…' }).click();
  const view = page.getByTestId('waterfall-view');
  await expect(view).toHaveAttribute('data-viz3d', 'ready');
  return view;
}

test.describe('3D data views', () => {
  test('waterfall opens from a strip gutter after 3+ runs', async ({ page }) => {
    const log = collectConsole(page);
    await openDev(page);
    const view = await openWaterfallFromGutter(page, 'speed');
    await expect(view.locator('canvas')).toHaveCount(1);
    await expect(view).toHaveAttribute('data-ribbons', '5');
    await expect(view.getByTestId('viz3d-legend')).toContainText('current · RUN 5');
    // Axis labels carry units.
    await expect(view.locator('.viz3d__title', { hasText: 'speed · km/h' })).toHaveCount(1);
    await expect(view.locator('.viz3d__title', { hasText: 't · s' })).toHaveCount(1);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/waterfall.png` });

    // Hover a ribbon: highlight + `RUN n · setup chips` tooltip.
    const box = (await view.boundingBox())!;
    const tip = view.locator('.viz3d__tip');
    let hit = false;
    for (let fx = 0.35; fx < 0.7 && !hit; fx += 0.03) {
      for (let fy = 0.2; fy < 0.85 && !hit; fy += 0.015) {
        await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
        hit = await tip.isVisible();
      }
    }
    expect(hit).toBe(true);
    await expect(tip).toHaveText(
      /^RUN \d · ramp \d\.\d{3} s · pressure \d\.\d{2} bar · \d+\.\d{3} s$/,
    );
    await page.screenshot({ path: `${SHOTS}/waterfall-hover.png` });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('waterfall-overlay')).toHaveCount(0);
    expect(log.errors).toEqual([]);
  });

  test('response surface renders (2 levers) and falls back to a curve (1 lever)', async ({
    page,
  }) => {
    const log = collectConsole(page);
    await openDev(page);
    const view = page.getByTestId('response-surface-view');
    await expect(view).toHaveAttribute('data-viz3d', 'ready');
    await expect(view.locator('canvas')).toHaveCount(1);
    await expect(view).toHaveAttribute('data-kind', 'surface');
    await expect(view).toHaveAttribute('data-levers', 'throttle_ramp,tire_pressure');
    await expect(view.getByTestId('viz3d-legend')).toContainText('optimum');
    await expect(view.locator('.viz3d__run')).toHaveCount(5);
    await expect(view.locator('.viz3d__title', { hasText: 'time · s' })).toHaveCount(1);
    await expect(view.locator('.viz3d__title', { hasText: 'tire_pressure · bar' })).toHaveCount(1);
    await page.waitForTimeout(300);
    await page.getByTestId('response-surface').screenshot({ path: `${SHOTS}/surface.png` });

    await page.getByRole('radio', { name: '1 lever (A1)' }).click();
    await expect(view).toHaveAttribute('data-kind', 'curve');
    // Old labels are gone after the swap.
    await expect(view.locator('.viz3d__title', { hasText: 'tire_pressure' })).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.getByTestId('response-surface').screenshot({ path: `${SHOTS}/curve.png` });

    await page.getByRole('radio', { name: 'Imperial' }).click();
    await page.getByRole('radio', { name: '2 levers' }).click();
    await expect(view.locator('.viz3d__title', { hasText: 'tire_pressure · psi' })).toHaveCount(1);
    expect(log.errors).toEqual([]);
  });

  test('5 open/close cycles and a route change leave no WebGL contexts behind', async ({
    page,
  }) => {
    const log = collectConsole(page);
    await openDev(page);
    for (let i = 0; i < 5; i++) {
      await openWaterfallFromGutter(page, i % 2 ? 'throttle' : 'speed');
      await page.getByRole('button', { name: 'Close waterfall' }).click();
      await expect(page.getByTestId('waterfall-overlay')).toHaveCount(0);
      await page.getByRole('radio', { name: 'Off' }).click();
      await expect(page.getByTestId('response-surface')).toHaveCount(0);
      await page.getByRole('radio', { name: 'Surface on' }).click();
      await expect(page.getByTestId('response-surface-view')).toHaveAttribute(
        'data-viz3d',
        'ready',
      );
    }
    await page.evaluate(() => {
      location.hash = '#/';
    });
    await expect(page.getByTestId('response-surface')).toHaveCount(0);
    expect(await page.locator('canvas').count()).toBe(0);
    expect(log.contextWarnings).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  test('reduced motion turns orbit damping off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDev(page);
    await expect(page.getByTestId('response-surface-view')).toHaveAttribute(
      'data-damping',
      'false',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('radio', { name: 'Off' }).click();
    await page.getByRole('radio', { name: 'Surface on' }).click();
    await expect(page.getByTestId('response-surface-view')).toHaveAttribute('data-damping', 'true');
  });
});

test.describe('3D data views in the single-file build', () => {
  const SINGLE = resolve(process.cwd(), 'dist-single/signal.html');

  test('surface and waterfall work from file:// (three.js inlined)', async ({ page, context }) => {
    test.skip(!existsSync(SINGLE), 'run `npm run build:single` first');
    const log = collectConsole(page);
    const requests: string[] = [];
    context.on('request', (r) => requests.push(r.url()));
    await context.setOffline(true);
    await openDev(page, `${pathToFileURL(SINGLE).href}#/dev/viz3d`);
    await expect(page.getByTestId('response-surface-view')).toHaveAttribute('data-viz3d', 'ready');
    await openWaterfallFromGutter(page, 'speed');
    expect(requests.filter((u) => !/^(file|data|blob):/.test(u))).toEqual([]);
    expect(log.errors).toEqual([]);
  });
});
