import { expect, test } from '@playwright/test';
import { fresh, setLever } from './helpers';

/**
 * Stage 6 Pipeline Test (browser): level select → brief → grid-search progress on RUN → runs →
 * hints (budget decrements) → pass → debrief → progression persisted across a reload. Plus the
 * acceptance checks for the strip layout, units, the fault panel and the keyboard map.
 */

test('A1 → A2: hints cost runs, A2 passes, progress survives a reload', async ({ page }) => {
  await fresh(page);
  // A1 in one run.
  await page.getByTestId('level-row-A1').click();
  await page.getByTestId('begin').click();
  await setLever(page, 'throttle_ramp', '0');
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('chip-target')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Continue to debrief' }).click();
  await page.getByTestId('next-level').click();
  await expect(page).toHaveURL(/#\/level\/A2$/);

  // The brief shows the grid-search progress, then the target.
  await expect(page.getByTestId('brief')).toBeVisible();
  await expect(page.getByTestId('brief-target')).toHaveText(/\d+\.\d{3}/, { timeout: 30_000 });
  await page.getByTestId('begin').click();

  // The A1 layout persisted (it is global), and A1 strips missing here would be placeholders.
  const pips = page.getByTestId('run-pips');
  await expect(pips).toHaveAttribute('aria-label', '6 of 6 runs left');

  // Run 1 at the defaults (no ramp, pressure off-peak): the rears spin.
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('rh-time')).toBeVisible({ timeout: 30_000 });
  await expect(pips).toHaveAttribute('aria-label', '5 of 6 runs left');

  // H opens the hint popover; the first press arms, the second opens tier 1 and spends a run.
  await page.keyboard.press('h');
  const open = page.getByTestId('hint-open');
  await expect(open).toBeVisible();
  await open.click();
  await expect(open).toHaveText(/OPEN −1 RUN\?/);
  await open.click();
  await expect(page.getByTestId('hint-popover')).toContainText('rear_slip_ratio');
  await expect(pips).toHaveAttribute('aria-label', '4 of 6 runs left, 1 spent on hints');

  // The cited channel is a link: it pulls the strip into the stack.
  await page.getByTestId('hint-popover').getByRole('button', { name: 'rear_slip_ratio' }).click();
  await expect(
    page.locator('[data-testid="strip-stack"] >> text=rear_slip_ratio').first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // Units convert the lever readouts.
  await page.getByRole('radio', { name: 'Imperial' }).click();
  await expect(page.getByTestId('lever-value-tire_pressure')).toHaveText(/psi$/);
  await page.getByRole('radio', { name: 'Metric' }).click();

  // Fix both levers and pass with the grid optimum's neighbourhood: a short ramp, pressure on peak.
  await setLever(page, 'throttle_ramp', '0.2');
  await setLever(page, 'tire_pressure', '1.6');
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('chip-target')).toBeVisible({ timeout: 30_000 });
  await expect(pips).toHaveAttribute('aria-label', '3 of 6 runs left, 1 spent on hints');

  await page.getByRole('button', { name: 'Continue to debrief' }).click();
  await expect(page.getByTestId('convergence').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('debrief-summary')).toContainText(
    'Target met in 2 runs, 1 hint tier',
  );

  // Progress persists across a reload.
  await page.reload();
  await page.goto('/');
  await expect(page.getByTestId('status-A1')).toHaveText('passed');
  await expect(page.getByTestId('status-A2')).toHaveText('passed');
  await expect(page.getByTestId('status-A3')).toHaveText('open');
});

test('a forced engine error shows the fault panel and does not consume the run', async ({
  page,
}) => {
  await fresh(page);
  await page.getByTestId('level-row-A1').click();
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('run-button')).toBeEnabled({ timeout: 30_000 });
  await page.evaluate(() => {
    (globalThis as unknown as { __SIGNAL_FORCE_FAULT__?: boolean }).__SIGNAL_FORCE_FAULT__ = true;
  });
  await page.getByTestId('run-button').click();
  const fault = page.getByTestId('fault-panel');
  await expect(fault).toBeVisible({ timeout: 30_000 });
  await expect(fault).toContainText('SimInputError');
  await expect(fault).toContainText('did not count against the run budget');
  await expect(page.getByTestId('copy-repro')).toBeVisible();
  await expect(page.getByTestId('run-pips')).toHaveAttribute('aria-label', '5 of 5 runs left');

  await page.evaluate(() => {
    (globalThis as unknown as { __SIGNAL_FORCE_FAULT__?: boolean }).__SIGNAL_FORCE_FAULT__ = false;
  });
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('rh-time')).toBeVisible({ timeout: 30_000 });
  await expect(fault).toBeHidden();
  await expect(page.getByTestId('run-pips')).toHaveAttribute('aria-label', '4 of 5 runs left');
});

test('strip layout persists across reloads; ⌘K adds a channel; R runs', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('level-row-A1').click();
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('run-button')).toBeEnabled({ timeout: 30_000 });

  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('palette');
  await expect(palette).toBeVisible();
  await page.keyboard.type('drag_force');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await page.keyboard.press('r');
  await expect(page.getByTestId('rh-time')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="strip-stack"] >> text=drag_force').first(),
  ).toBeVisible();

  await page.reload();
  await page.getByTestId('begin').click();
  const layout = await page.evaluate(() => localStorage.getItem('signal.v1.layout'));
  expect(layout).toContain('drag_force');
  await expect(
    page.locator('[data-testid="strip-stack"] >> text=drag_force').first(),
  ).toBeVisible();
});
