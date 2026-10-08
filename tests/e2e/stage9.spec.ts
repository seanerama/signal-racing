import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fresh, setLever } from './helpers';
import { runAndWait } from './demo-path';

/**
 * Stage 9 (standard build): the grip circle mid-corner on A4, the Puzzle's Make-the-call flow
 * (run 2 → call → flag and cross-check → strips added → debrief), the Model page, and the
 * level-select disclaimer. Screenshots land in `test-results/stage-9/`.
 */
const DIR = resolve(process.cwd(), 'test-results/stage-9');
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: resolve(DIR, `${name}.png`) });
}

test('level select: disclaimer and the model link', async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId('disclaimer-select')).toHaveText(
    'Independent educational prototype. Not affiliated with any racing team or company. The car is approximate and does not model any real vehicle.',
  );
  await expect(page.getByTestId('model-link')).toBeVisible();
  await shot(page, 'level-select-disclaimer');
});

test('A4: the grip circle follows the cursor mid-corner', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?demo=1&playback=instant#/level/A4');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('begin').click();
  await setLever(page, 'wing', '5');
  await runAndWait(page, 1);
  await setLever(page, 'wing', '7');
  await runAndWait(page, 2);
  const circle = page.getByTestId('grip-circle');
  await expect(circle).toBeVisible();
  const canvas = circle.locator('canvas');
  const before = await canvas.getAttribute('data-draws');
  // Pin the cursor in the corner (the corner is roughly the middle of the run).
  const plot = page.locator('[data-testid="strip-stack"] .u-over').first();
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect(canvas).not.toHaveAttribute('data-draws', before ?? '');
  await expect(circle).toHaveAttribute(
    'aria-label',
    /grip used front (0\.9\d|1\.\d\d), rear 0\.[5-9]\d/,
  );
  await shot(page, 'a4-grip-circle-mid-corner');
});

test('B4L: make the call on run 2, cross-check, debrief, model page', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?demo=1&playback=instant#/level/B4L');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('disclaimer-brief')).toBeVisible();
  await page.getByTestId('begin').click();
  await runAndWait(page, 1);
  await expect(page.getByTestId('call-panel')).toHaveCount(0);
  await runAndWait(page, 2);
  const panel = page.getByTestId('call-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('speed_diff_rl');
  await expect(panel).toContainText('km/h');
  const pips = await page.locator('.topbar__pips').innerText();
  await page.getByTestId('call-opt-flag').click();
  await expect(page.getByTestId('call-result')).toContainText('The call');
  expect(await page.locator('.topbar__pips').innerText()).toBe(pips);
  for (const id of ['rear_slip_ratio', 'wheel_speed_rl']) {
    await page.getByTestId(`call-add-${id}`).click();
    await expect(page.locator(`[data-testid="strip-stack"] [data-strip="${id}"]`)).toHaveCount(1);
  }
  // Park the cursor near the spike so the readouts show values (the added strips sit below the
  // fold with Stage 10's taller strips: bring the last one into view first).
  await page
    .locator('[data-testid="strip-stack"] [data-strip="wheel_speed_rl"]')
    .first()
    .scrollIntoViewIfNeeded();
  const plot = page.locator('[data-testid="strip-stack"] .u-over').first();
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.272, box.y + box.height / 2);
  await expect(
    page.locator('[data-testid="strip-stack"] [data-strip="wheel_speed_rl"] canvas').first(),
  ).toBeVisible();
  await shot(page, 'b4l-make-the-call');

  // Finish with the setup the earlier levels teach, then the debrief shows the call.
  for (const [id, v] of [
    ['throttle_ramp', '0'],
    ['tire_pressure', '1.6'],
    ['weight_dist', '0.52'],
    ['wing', '3'],
  ] as const) {
    await setLever(page, id, v);
  }
  await runAndWait(page, 3);
  await expect(page.getByTestId('call-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to debrief' }).click();
  await expect(page.getByTestId('debrief-calls')).toContainText('Your call');
  await expect(page.getByTestId('debrief-call-verdict')).toHaveText('✓ The call.');
  await page.getByTestId('debrief-model-link').click();
  await expect(page.getByTestId('model-page')).toBeVisible();
});

test('Model page: equations in MathML, car table, sources, from the info menu', async ({
  page,
}) => {
  await fresh(page);
  await page.getByTestId('info-button').click();
  await page.getByTestId('info-model').click();
  const model = page.getByTestId('model-page');
  await expect(model).toBeVisible();
  expect(await model.locator('math').count()).toBeGreaterThanOrEqual(20);
  await expect(page.getByTestId('car-table').locator('tbody tr')).toHaveCount(26);
  await expect(page.getByTestId('disclaimer-model')).toBeVisible();
  await expect(page.getByTestId('artifact-disclosure')).toContainText('speed_diff_rl');
  await expect(page.getByTestId('sources').locator('li')).toHaveCount(5);
  await shot(page, 'model-page');
  await model.locator('[data-eq="friction-circle"]').scrollIntoViewIfNeeded();
  await shot(page, 'model-page-equations');
});
