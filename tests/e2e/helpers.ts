/** Shared e2e helpers (not a spec). */
import { expect, type Page } from '@playwright/test';

/**
 * A fresh profile with instant playback (Stage 10: `?playback=instant` sets the persisted
 * playback pref, so runs render complete at once and the suite stays fast).
 */
export async function fresh(page: Page): Promise<void> {
  await page.goto('/?playback=instant');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?playback=instant');
  await expect(page.getByTestId('level-select')).toBeVisible();
}

export async function setLever(page: Page, id: string, value: string): Promise<void> {
  await page.getByTestId(`lever-value-${id}`).click();
  const input = page.getByTestId(`lever-input-${id}`);
  await input.fill(value);
  await input.press('Enter');
}
