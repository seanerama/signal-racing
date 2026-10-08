/**
 * The signal.md meeting demo ("The meeting demo, in two minutes"), shared by `demo.spec.ts`
 * (standard build behind `vite preview`) and `single-file.spec.ts` (`dist-single/signal.html`
 * from `file://`, network blocked). Not a spec.
 *
 * Open the Puzzle with the demo profile → run at defaults → scroll the 200-channel table to the
 * bottom → export the CSV (download fires; header > 200 commas; units row) → assist on → run again
 * → the assist shows five rows → (Stage 9) the grip circle is up and the call panel asks about run 2's
 * spike: flag it, cross-check → finish (the target) → the debrief shows the with/without numbers
 * and the call → the Model page.
 *
 * Stage 10: the demo plays every run back in real time at `DEMO_SPEED` (4× by default; set
 * `SIGNAL_DEMO_SPEED=1` to time it at 1×). Results, the assist rows and Make the call appear when
 * a run's playback ends, so `runAndWait` waits for the revealed header.
 */
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { setLever } from './helpers';

export const SHOT_DIR = resolve(process.cwd(), 'test-results/stage-9');

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}.png`) });
}

/** Playback speed for the meeting demo (Stage 10): 4× unless `SIGNAL_DEMO_SPEED` says 1 or 2. */
export const DEMO_SPEED: 1 | 2 | 4 = (() => {
  const v = Number(process.env['SIGNAL_DEMO_SPEED'] ?? 4);
  return v === 1 || v === 2 ? v : 4;
})();
/** Generous enough for three B4L laps played back at 1×. */
export const DEMO_TIMEOUT_MS = DEMO_SPEED === 1 ? 420_000 : 200_000;

/**
 * Clicks RUN and waits for run `n`'s results to be revealed (instant, or at the end of its
 * playback: the header's `data-run` is `n`, not `n-live`).
 */
export async function runAndWait(page: Page, n: number): Promise<void> {
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('result-header')).toHaveAttribute('data-run', String(n), {
    timeout: 150_000,
  });
  await expect(page.locator('.rh__run')).toHaveText(`RUN ${n}`);
}

export interface DemoOptions {
  /** URL of the app with `?demo=1` and the B4L hash. */
  url: string;
  /** Screenshot name suffix ('' = the finals; e.g. '-single'). */
  suffix: string;
}

export async function playMeetingDemo(page: Page, { url, suffix }: DemoOptions): Promise<void> {
  await page.goto(url);
  // Fresh demo state (the context is fresh; this guards a reused profile), with real-time
  // playback at the demo speed.
  await page.evaluate((speed) => {
    localStorage.clear();
    localStorage.setItem('signal.v1.playbackMode', JSON.stringify({ v: 1, data: 'realtime' }));
    localStorage.setItem('signal.v1.playbackSpeed', JSON.stringify({ v: 1, data: speed }));
  }, DEMO_SPEED);
  await page.reload();

  const chip = page.getByTestId('demo-chip');
  await expect(chip).toHaveText('DEMO PROFILE');
  await expect(page.getByTestId('brief')).toBeVisible();
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('workbench')).toHaveAttribute('data-level', 'B4L');

  // 1. Run once with everything at defaults.
  await runAndWait(page, 1);

  // 2. Scroll the ~200-channel report to the bottom.
  const table = page.getByTestId('channel-table');
  const count = Number(await table.locator('.ct__title .micro').textContent());
  expect(count).toBeGreaterThanOrEqual(200);
  await table.locator('.ct__scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
  const last = table.locator('tbody tr.ct__row').last();
  await expect(last).toHaveAttribute('data-channel', 'yaw_rate');
  await expect(last).toBeInViewport();
  await shot(page, `b4l-channels-200${suffix}`);

  // 3. Export the run's CSV.
  const download = page.waitForEvent('download');
  await page.getByTestId('csv-button').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('signal_B4L_run1.csv');
  const path = await file.path();
  mkdirSync(SHOT_DIR, { recursive: true });
  await file.saveAs(resolve(SHOT_DIR, `signal_B4L_run1${suffix}.csv`));
  const lines = readFileSync(path, 'utf8').split('\n');
  const header = lines.find((l) => l.startsWith('t,s,'))!;
  expect(header.split(',').length - 1).toBeGreaterThan(200);
  const units = lines[lines.indexOf(header) + 1]!;
  expect(units.startsWith('s,m,')).toBe(true);
  expect(units.split(',').length).toBe(header.split(',').length);

  // 4. Assist on (after the recorded attempt is re-simulated), run again: five channels.
  await expect(chip).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  const toggle = page.getByTestId('assist-toggle');
  await toggle.check({ force: true });
  await expect(toggle).toBeChecked();
  await runAndWait(page, 2);
  const rows = page.getByTestId('assist-rows').locator('li');
  await expect(rows).toHaveCount(5);
  await expect(page.getByTestId('assist-foot')).toContainText('2 this session');
  await expect(page.getByTestId('assist-foot')).toContainText('recorded (demo profile)');
  // The assist names channels only: never a lever.
  const text = (await page.getByTestId('assist-rows').innerText()).toLowerCase();
  for (const lever of [
    'throttle_ramp',
    'tire_pressure',
    'weight_dist',
    'throttle ramp',
    'tire pressure',
    'weight distribution',
    'wing',
  ])
    expect(text, lever).not.toContain(lever);
  await table.locator('.ct__scroll').evaluate((el) => (el.scrollTop = 0));
  await shot(page, `b4l-assist${suffix}`);

  // 4b. Stage 9 beats: the grip circle under the track view, and Make the call on run 2.
  await expect(page.getByTestId('grip-circle')).toBeVisible();
  const call = page.getByTestId('call-panel');
  await expect(call).toBeVisible();
  await expect(call).toContainText('speed_diff_rl');
  await page.getByTestId('call-opt-flag').click();
  await expect(page.getByTestId('call-result')).toContainText('The call');
  await page.getByTestId('call-add-rear_slip_ratio').click();
  await expect(
    page.locator('[data-testid="strip-stack"] [data-strip="rear_slip_ratio"]'),
  ).toHaveCount(1);
  await shot(page, `b4l-call${suffix}`);

  // 5. Finish: the setup the earlier levels teach reaches the target.
  for (const [id, v] of [
    ['throttle_ramp', '0'],
    ['tire_pressure', '1.6'],
    ['weight_dist', '0.52'],
    ['wing', '3'],
  ] as const) {
    await setLever(page, id, v);
  }
  await runAndWait(page, 3);
  await expect(page.getByTestId('chip-target')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to debrief' }).click();

  // 6. The debrief: with and without the assist.
  const cmp = page.getByTestId('assist-comparison');
  await expect(cmp).toBeVisible();
  await expect(page.getByTestId('cmp-with')).toContainText('3');
  await expect(page.getByTestId('cmp-with')).toContainText('your attempts');
  await expect(page.getByTestId('cmp-without')).toContainText('8');
  await expect(page.getByTestId('cmp-without')).toContainText('recorded attempt (demo profile)');
  await expect(page.getByTestId('spurious-note')).toBeVisible();
  await expect(page.getByTestId('debrief-call-verdict')).toHaveText('✓ The call.');
  await shot(page, `b4l-debrief-comparison${suffix}`);

  // 7. The model page is one click from the debrief (and renders offline).
  await page.getByTestId('debrief-model-link').click();
  await expect(page.getByTestId('model-page')).toBeVisible();
  expect(await page.getByTestId('model-page').locator('math').count()).toBeGreaterThanOrEqual(20);
  await expect(page.getByTestId('disclaimer-model')).toBeVisible();
  await shot(page, `model-page${suffix}`);
}
