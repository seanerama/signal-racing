import { expect, test } from '@playwright/test';
import { fresh, setLever } from './helpers';

/**
 * Stage 6 acceptance: open A1 → BEGIN → set the ramp to 0 → RUN → the header shows a time at or
 * under the target with the TARGET chip → the debrief renders the convergence table → A2 is
 * unlocked in the level select.
 */

/** Seconds from a readout like `17.977 s` / `17.977s`. */
const secs = (text: string | null): number => Number((text ?? '').replace(/[^\d.]/g, ''));

test('play A1: brief, one run at full throttle, target, debrief, A2 unlocked', async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId('status-A1')).toHaveText('open');
  await expect(page.getByTestId('status-A2')).toHaveText('locked');

  await page.getByTestId('level-row-A1').click();
  const brief = page.getByTestId('brief');
  await expect(brief).toBeVisible();
  await expect(brief).toContainText('table on the right');
  await expect(page.getByTestId('brief-target')).toHaveText(/\d+\.\d{3}/, { timeout: 30_000 });
  const target = secs(await page.getByTestId('brief-target').textContent());
  await page.getByTestId('begin').click();
  await expect(brief).toBeHidden();

  await setLever(page, 'throttle_ramp', '0');
  await expect(page.getByTestId('lever-value-throttle_ramp')).toHaveText('0.000 s');
  await page.getByTestId('run-button').click();

  await expect(page.getByTestId('rh-time')).toBeVisible({ timeout: 30_000 });
  const time = secs(await page.getByTestId('rh-time').textContent());
  expect(time).toBeGreaterThan(0);
  expect(time).toBeLessThanOrEqual(target);
  await expect(page.getByTestId('chip-target')).toBeVisible();
  await expect(page.getByTestId('run-pips')).toHaveAttribute('aria-label', /4 of 5 runs left/);

  await page.getByRole('button', { name: 'Continue to debrief' }).click();
  await expect(page).toHaveURL(/#\/level\/A1\/debrief$/);
  const table = page.getByTestId('convergence');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('debrief-summary')).toHaveText('Target met in 1 run.');
  await expect(page.getByTestId('response-surface-slot')).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('status-A1')).toHaveText('passed');
  await expect(page.getByTestId('status-A2')).toHaveText('open');
});
