import { expect, test, type Page } from '@playwright/test';
import { fresh, setLever } from './helpers';

/**
 * Stage 10 (standard build): real-time run playback (progressive strips, results at the end,
 * 4×, pause, skip, replay, keyboard), unlimited runs and the five-run unlock, the closable hint
 * box, Compact density from ⌘K, and the channel browser drawer below 1280 px.
 */

async function openRealtime(page: Page, hash: string, speed: 1 | 2 | 4): Promise<void> {
  await page.goto(`/?demo=1${hash}`);
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('signal.v1.playbackMode', JSON.stringify({ v: 1, data: 'realtime' }));
    localStorage.setItem('signal.v1.playbackSpeed', JSON.stringify({ v: 1, data: s }));
  }, speed);
  await page.reload();
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('run-button')).toBeEnabled({ timeout: 30_000 });
}

const drawn = (page: Page) =>
  page.locator('[data-testid="strip-stack"] .strip[data-strip]').first().getAttribute('data-drawn');

test('playback at 4×: the strips grow, the car drives, results appear at the end', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openRealtime(page, '#/level/A4', 4);
  await expect(page.getByTestId('pb-speed-4')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('run-button').click();

  // Live: the header counts, the results and hints wait, RUN is disabled.
  const header = page.getByTestId('result-header');
  await expect(header).toHaveAttribute('data-run', '1-live', { timeout: 30_000 });
  await expect(page.getByTestId('rh-live-time')).toBeVisible();
  await expect(page.getByTestId('rh-time')).toHaveCount(0);
  await expect(page.getByTestId('run-button')).toBeDisabled();
  await expect(page.getByTestId('hint-pending')).toBeVisible();

  // The current trace is drawn progressively: the drawn sample count grows.
  await expect
    .poll(async () => Number((await drawn(page)) ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(50);
  const a = Number(await drawn(page));
  const ta = Number((await page.getByTestId('rh-live-time').innerText()).replace(/[^\d.]/g, ''));
  await page.waitForTimeout(600);
  const b = Number(await drawn(page));
  const tb = Number((await page.getByTestId('rh-live-time').innerText()).replace(/[^\d.]/g, ''));
  expect(b).toBeGreaterThan(a);
  // 4×: ~0.6 s wall ≈ 2.4 s of run time (generous bounds for a loaded CI box).
  expect(tb - ta).toBeGreaterThan(1.0);
  const car = page.getByTestId('trackview').locator('canvas');
  const idx1 = Number(await car.getAttribute('data-cursor-idx'));
  await page.waitForTimeout(300);
  expect(Number(await car.getAttribute('data-cursor-idx'))).toBeGreaterThan(idx1);

  // The end: results revealed, the trace complete, RUN back.
  await expect(header).toHaveAttribute('data-run', '1', { timeout: 30_000 });
  await expect(page.getByTestId('rh-time')).toBeVisible();
  expect(await drawn(page)).toBe('all');
  await expect(page.getByTestId('run-button')).toBeEnabled();
  await expect(page.getByTestId('hint-pending')).toHaveCount(0);

  const stats = await page.evaluate(() => globalThis.__SIGNAL_PLAYBACK__?.stats());
  console.log(`[playback A4 4×] frame work ${JSON.stringify(stats)}`);
});

test('pause, resume, skip and replay; Space and S on the keyboard', async ({ page }) => {
  test.setTimeout(90_000);
  await openRealtime(page, '#/level/A4', 1);
  await page.getByTestId('run-button').click();
  const header = page.getByTestId('result-header');
  await expect(header).toHaveAttribute('data-run', '1-live', { timeout: 30_000 });

  // Space pauses: the playhead holds.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('playback')).toHaveAttribute('data-state', 'paused');
  const held = await drawn(page);
  await page.waitForTimeout(400);
  expect(await drawn(page)).toBe(held);
  // Resume with the button; speed 2 from the keyboard.
  await page.getByTestId('pb-pause').click();
  await expect(page.getByTestId('playback')).toHaveAttribute('data-state', 'playing');
  await page.keyboard.press('2');
  await expect(page.getByTestId('pb-speed-2')).toHaveAttribute('aria-checked', 'true');
  // S skips to the finish: results at once.
  await page.keyboard.press('s');
  await expect(header).toHaveAttribute('data-run', '1');
  expect(await drawn(page)).toBe('all');

  // Replay plays the finished run again; the results stay visible.
  await page.getByTestId('pb-replay').click();
  await expect(page.getByTestId('playback')).toHaveAttribute('data-state', 'playing');
  await expect(header).toHaveAttribute('data-run', '1');
  await expect(page.getByTestId('rh-time')).toBeVisible();
  await page.getByTestId('pb-skip').click();
  await expect(page.getByTestId('playback')).toHaveAttribute('data-state', 'idle');
  // The speed choice persists.
  expect(await page.evaluate(() => localStorage.getItem('signal.v1.playbackSpeed'))).toContain('2');
});

test('prefers-reduced-motion shows new runs complete; Replay still plays', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await openRealtime(page, '#/level/A1', 1);
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('result-header')).toHaveAttribute('data-run', '1', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('playback')).toHaveAttribute('data-state', 'idle');
  await page.getByTestId('pb-replay').click();
  await expect(page.getByTestId('playback')).toHaveAttribute('data-state', 'playing');
  await context.close();
});

test('unlimited runs, free hints counted, and the next level unlocks after five runs', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await fresh(page);
  await page.getByTestId('level-row-A1').click();
  await page.getByTestId('brief-budget').waitFor();
  await expect(page.getByTestId('brief-budget')).toContainText('Runs to target');
  await page.getByTestId('begin').click();
  // A slow setup, six times (the old budget was five): never refused, never exhausted.
  await setLever(page, 'throttle_ramp', '3');
  for (let n = 1; n <= 6; n++) {
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('result-header')).toHaveAttribute('data-run', String(n), {
      timeout: 30_000,
    });
  }
  await expect(page.getByTestId('chip-target')).toHaveCount(0);
  await expect(page.getByTestId('run-count')).toHaveAttribute(
    'aria-label',
    '6 runs made, 0 hints opened',
  );
  await page.goto('/');
  await expect(page.getByTestId('status-A1')).toHaveText('in progress');
  await expect(page.getByTestId('status-A2')).toHaveText('open');
});

test('the hint box closes and reopens (× and H), and says when a new rule fired', async ({
  page,
}) => {
  await fresh(page);
  await page.goto('/?playback=instant&demo=1#/level/A2');
  await page.getByTestId('begin').click();
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('result-header')).toHaveAttribute('data-run', '1', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('hint-box')).toBeVisible();
  await page.getByTestId('hint-close').click();
  await expect(page.getByTestId('hint-box')).toHaveCount(0);
  await expect(page.getByTestId('hint-new')).toContainText('new');
  await page.keyboard.press('h');
  await expect(page.getByTestId('hint-box')).toBeVisible();
  await page.getByTestId('hint-open').click();
  await expect(page.getByTestId('hint-box')).toContainText('free · 1 opened');
  // Closed state persists for the session: leave (in-app) and come back.
  await page.getByTestId('hint-close').click();
  await page.getByRole('link', { name: 'Signal: level select' }).click();
  await page.getByTestId('level-row-A2').click();
  await expect(page.getByTestId('hint-reopen')).toBeVisible();
});

test('Compact density from ⌘K, persisted', async ({ page }) => {
  await fresh(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette').locator('.palette__input')).toBeFocused();
  await page.keyboard.type('Density');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  const run = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--control-h-run').trim(),
  );
  expect(run).toBe('32px');
});

test('below 1280 px the track and channel browser become a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await fresh(page);
  await page.getByTestId('level-row-A1').click();
  await page.getByTestId('begin').click();
  const table = page.getByTestId('channel-table');
  await expect(table).toBeHidden();
  await page.getByTestId('drawer-tab').click();
  await expect(table).toBeVisible();
  await page.getByTestId('drawer-tab').click();
  await expect(table).toBeHidden();
});
