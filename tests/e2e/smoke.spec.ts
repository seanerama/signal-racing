import { expect, test } from '@playwright/test';

/** Smoke: runs against `vite preview` of `dist/`. The unit samples live on `#/dev` since Stage 6. */
test('app loads with the top bar and the level select', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('level-select')).toBeVisible();
  const bar = page.getByTestId('topbar');
  await expect(bar).toBeVisible();
  await expect(bar.getByText('SIGNAL')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Units' })).toBeVisible();
});

test('units toggle switches displayed units', async ({ page }) => {
  await page.goto('/#/dev');
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
