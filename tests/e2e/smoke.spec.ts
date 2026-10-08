import { expect, test } from '@playwright/test';

/** Smoke (stub, Stage 1): runs against `vite preview` of `dist/`. Stage 6 extends it. */
test('app loads with the top bar', async ({ page }) => {
  await page.goto('/');
  const bar = page.getByTestId('topbar');
  await expect(bar).toBeVisible();
  await expect(bar.getByText('SIGNAL')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Units' })).toBeVisible();
});

test('units toggle switches displayed units', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('sample-speed')).toHaveText('100.0 km/h');
  await page.getByRole('radio', { name: 'Imperial' }).click();
  await expect(page.getByTestId('sample-speed')).toHaveText('62.1 mph');
  await expect(page.getByTestId('sample-pressure')).toHaveText('23.9 psi');
});

test('/#/dev/worker shows pong', async ({ page }) => {
  await page.goto('/#/dev/worker');
  await expect(page.getByTestId('worker-status')).toHaveText('pong');
  await expect(page.getByTestId('worker-rtt')).toHaveText(/^\d+\.\d{2} ms$/);
});
