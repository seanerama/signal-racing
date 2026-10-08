import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 4: `/#/dev/report` (the report gallery, from fixtures). Behaviour checks plus the visual
 * check screenshots at 1440×900 and 1280×720 (saved to test-results/stage-4/; no pixel-diff gate).
 */

async function trackIdx(page: Page): Promise<number> {
  const v = await page.locator('[data-testid="trackview"] canvas').getAttribute('data-cursor-idx');
  return Number(v);
}

/** Left offsets (CSS px) of every strip's cursor line. */
async function cursorLefts(page: Page): Promise<number[]> {
  return page
    .locator('.strips .u-cursor-x')
    .evaluateAll((els) =>
      els.map((e) => Math.round(new DOMMatrix(getComputedStyle(e).transform).m41)),
    );
}

test.describe('dev report', () => {
  test('200 channels in the table, 6 strips → exactly 6 uPlot instances', async ({ page }) => {
    await page.goto('/#/dev/report');
    await page.getByRole('radio', { name: '200 ch' }).click();
    await expect(page.getByTestId('channel-table').getByText('200', { exact: true })).toBeVisible();
    await expect(page.locator('.uplot')).toHaveCount(6);
    await expect(page.getByText('clutch_temp: not logged on this level')).toBeVisible();
    // Virtualised table: far fewer DOM rows than channels.
    expect(await page.locator('.ct tbody tr').count()).toBeLessThanOrEqual(40);
  });

  test('hovering a strip moves every cursor and the track-view block', async ({ page }) => {
    await page.goto('/#/dev/report');
    await expect(page.locator('.uplot')).toHaveCount(6);
    expect(await trackIdx(page)).toBe(0);
    const over = page.locator('.u-over').nth(1);
    const box = (await over.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect.poll(() => trackIdx(page)).toBeGreaterThan(100);
    const lefts = await cursorLefts(page);
    expect(lefts).toHaveLength(6);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('cursor-x')).toHaveText(/^\d+\.\d{3} s$/);
  });

  test('click pins the cursor; arrows step it', async ({ page }) => {
    await page.goto('/#/dev/report');
    const over = page.locator('.u-over').nth(0);
    const box = (await over.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
    await expect(page.locator('.strips--pinned')).toHaveCount(1);
    const pinned = await trackIdx(page);
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    expect(await trackIdx(page)).toBe(pinned);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => trackIdx(page)).toBe(pinned + 1);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => trackIdx(page)).toBe(pinned + 11);
    await page.keyboard.press('Escape');
    await expect(page.locator('.strips--pinned')).toHaveCount(0);
  });

  test('Replay sweeps the strips and the block together', async ({ page }) => {
    await page.goto('/#/dev/report');
    await page.getByRole('button', { name: /Replay/ }).click();
    await expect.poll(() => trackIdx(page), { timeout: 3000 }).toBeGreaterThan(50);
    const lefts = await cursorLefts(page);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
    expect(Math.min(...lefts)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    const stopped = await trackIdx(page);
    await page.waitForTimeout(200);
    expect(await trackIdx(page)).toBe(stopped);
  });

  test('Shift+drag zooms every strip; double-click resets', async ({ page }) => {
    await page.goto('/#/dev/report');
    await expect(page.locator('.uplot')).toHaveCount(6);
    const b0 = (await page.locator('.u-over').nth(0).boundingBox())!;
    const b3 = (await page.locator('.u-over').nth(3).boundingBox())!;
    const hoverMid = async () => {
      await page.mouse.move(b0.x + b0.width * 0.5, b0.y + b0.height / 2);
      await page.waitForTimeout(50);
      return trackIdx(page);
    };
    const full = await hoverMid();
    await page.keyboard.down('Shift');
    await page.mouse.move(b3.x + b3.width * 0.2, b3.y + b3.height / 2);
    await page.mouse.down();
    await page.mouse.move(b3.x + b3.width * 0.4, b3.y + b3.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.locator('.strips--pinned')).toHaveCount(0);
    // Zoomed to ~20–40% of the run on every strip: the middle of strip 0 is now ~30%.
    const zoomed = await hoverMid();
    expect(zoomed).toBeLessThan(full * 0.75);
    expect(zoomed).toBeGreaterThan(full * 0.45);
    await page.mouse.dblclick(b0.x + b0.width * 0.5, b0.y + b0.height / 2);
    await page.keyboard.press('Escape'); // in case the double-click's clicks toggled a pin
    expect(Math.abs((await hoverMid()) - full)).toBeLessThanOrEqual(2);
  });

  test('projector mode rebuilds strips taller', async ({ page }) => {
    await page.goto('/#/dev/report');
    const h0 = (await page.locator('.uplot').first().boundingBox())!.height;
    await page.getByRole('radio', { name: 'Proj on' }).click();
    await expect
      .poll(async () => (await page.locator('.uplot').first().boundingBox())!.height)
      .toBeGreaterThan(h0);
    await expect(page.locator('.uplot')).toHaveCount(6);
  });

  for (const [w, h] of [
    [1440, 900],
    [1280, 720],
  ] as const) {
    test(`visual check ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/#/dev/report');
      await expect(page.locator('.uplot')).toHaveCount(6);
      // Hover so the cursor, readouts and track block are in the shot.
      const over = page.locator('.u-over').nth(2);
      const box = (await over.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.42, box.y + box.height / 2);
      await expect.poll(() => trackIdx(page)).toBeGreaterThan(0);
      await page.screenshot({ path: `test-results/stage-4/dev-report-${w}x${h}.png` });
    });
  }
});
