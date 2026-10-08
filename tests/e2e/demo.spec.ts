import { expect, test } from '@playwright/test';
import { fresh, setLever } from './helpers';
import { playMeetingDemo, runAndWait, shot } from './demo-path';

/**
 * Stage 8 Pipeline Test (standard build): the signal.md meeting demo end to end against
 * `vite preview`, plus the B1L join view and the in-browser live B4L grid-search timing.
 * Screenshots land in `test-results/stage-8/`.
 */

test('the meeting demo: Puzzle, 200 channels, CSV, assist, with/without debrief', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await playMeetingDemo(page, { url: '/?demo=1#/level/B4L', suffix: '' });
  expect(errors).toEqual([]);
});

test('B1L: three runs, segment_delta strip, boundaries and the compromise-gap chip', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/?demo=1#/level/B1L');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('begin').click();
  // Phase B: the axis switches to distance on first entry, and the Axis control is live.
  await expect(page.getByRole('radio', { name: 'Dist' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Dist' })).toBeEnabled();

  // The A4 answer (wing 7) first: the straight pays.
  await setLever(page, 'throttle_ramp', '0');
  await setLever(page, 'tire_pressure', '1.6');
  await setLever(page, 'weight_dist', '0.52');
  await runAndWait(page, 1);
  await expect(page.locator('.chip--extra').first()).toContainText('Compromise gap');
  await expect(page.locator('.chip--extra').first()).toHaveClass(/chip--loss/);
  await page.keyboard.press('h');
  await page.getByTestId('hint-open').click();
  await page.getByTestId('hint-open').click();
  await expect(page.getByTestId('hint-popover')).toContainText('ended the straight');
  await page.keyboard.press('Escape');

  // Lower the wing too far, then settle.
  await setLever(page, 'wing', '1');
  await runAndWait(page, 2);
  await setLever(page, 'wing', '3');
  await runAndWait(page, 3);
  await expect(page.locator('.chip--extra').first()).toHaveClass(/chip--best/);
  await expect(page.getByTestId('chip-target')).toBeVisible();

  // Pull segment_delta into the stack from the table.
  await page.getByLabel('Filter channels').fill('segment_delta');
  await page.locator('.ct__row[data-channel="segment_delta"]').click();
  await page.getByLabel('Filter channels').fill('');
  await page.getByLabel('Filter channels').blur();
  const strip = page.locator('[data-testid="strip-stack"] >> text=segment_delta').first();
  await expect(strip).toBeVisible();
  // Park the cursor at the end of the straight so every readout shows a value.
  const plot = page.locator('[data-testid="strip-stack"] .u-over').last();
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height / 2);
  await shot(page, 'b1l-join-3-runs');

  await page.getByRole('button', { name: 'Continue to debrief' }).click();
  await expect(page.getByTestId('join-table')).toBeVisible();
  await expect(page.getByTestId('join-table')).toContainText('Engine floor');
});

test('live B4L grid search in the browser stays under 4 s (logged)', async ({ page }) => {
  test.setTimeout(60_000);
  await fresh(page);
  await page.goto('/#/dev/worker');
  await expect(page.getByTestId('worker-status')).toHaveText('pong');
  await page.getByRole('button', { name: 'live grid B4L' }).click();
  const out = page.getByTestId('worker-grid-b4l');
  await expect(out).toBeVisible({ timeout: 30_000 });
  const r = JSON.parse((await out.textContent())!) as {
    ms: number;
    wallMs: number;
    evaluated: number;
  };
  console.log(
    `B4L live grid in the browser: ${r.ms} ms in the worker, ${r.wallMs} ms wall, ${r.evaluated} setups`,
  );
  expect(r.ms).toBeLessThan(4000);
});
