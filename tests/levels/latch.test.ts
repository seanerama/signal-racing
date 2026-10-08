/**
 * Stage 9 regression: the latched rear slide on B4L.
 *
 * Cause: in a corner the driver capped the drive demand at the row-20 friction circle, but
 * `(cap/F)·F` could round one ulp above the cap (a demand ratio of 1 + 2⁻⁵²). That started a
 * slide, and with the driver holding the ratio at 1 (≥ kRegrip) row 12b kept it for the whole
 * corner, with the slide heat multiplier on. The fix makes the cap inclusive and has the driver
 * lift when the rear arrives sliding in a corner (row 12b: wheelspin persists until the driver
 * lifts).
 *
 * Checked at the Stage 8 optimum and at every setup of the recorded demo attempt (which is where
 * the 590 °C rear tire was seen): the rear never slides through a corner hold, every rear slide
 * ends within 0.5 s of a brake release, and tire temperatures stay at or under 140 °C.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAR, simulate } from '@/engine/index';
import type { PhysicalColumns, Setup } from '@/engine/types';
import { B4L } from '@/levels/index';
import { buildSimInput } from '@/worker/build-input';
import history from '@/app/demo-history.json';

const STAGE8_OPTIMUM: Setup = {
  throttle_ramp: 0,
  tire_pressure: 1.6,
  weight_dist: 0.52,
  wing: 3,
};

const CASES: Array<{ label: string; setup: Setup; runIndex: number }> = [
  { label: 'Stage 8 optimum, run 1', setup: STAGE8_OPTIMUM, runIndex: 1 },
  ...history.runs.map((r) => ({
    label: `demo run ${r.runIndex}`,
    setup: r.setup,
    runIndex: r.runIndex,
  })),
];

/** Row 12b sliding shows as a slip ratio above the peak-grip slip. */
const sliding = (slip: number): boolean => slip > DEFAULT_CAR.sPeak + 1e-6;

function rearSlideAfterRelease(c: PhysicalColumns): number {
  const brake = c.ch.brake!;
  const slip = c.ch.rear_slip_ratio!;
  let worst = 0;
  for (let i = 1; i < c.n; i++) {
    if (!(brake[i - 1]! > 0 && brake[i] === 0)) continue;
    let j = i;
    while (j < c.n && sliding(slip[j]!)) j++;
    worst = Math.max(worst, (j - i) * c.dt);
  }
  return worst;
}

describe('B4L: no latched rear slide (Stage 9)', () => {
  for (const { label, setup, runIndex } of CASES) {
    it(label, () => {
      const c = simulate(buildSimInput(B4L, setup, runIndex), 'full').columns!;
      const slip = c.ch.rear_slip_ratio!;
      // Every slide that was on at a brake release ends within 0.5 s of it.
      expect(rearSlideAfterRelease(c)).toBeLessThanOrEqual(0.5);
      // No rear slide through a corner hold.
      const corners = B4L.track.segments
        .map((s, i) => (s.kind === 'corner' ? i : -1))
        .filter((i) => i >= 0);
      for (let i = 0; i < c.n; i++) {
        if (corners.includes(c.seg[i]!)) expect(sliding(slip[i]!), `${label} @${i}`).toBe(false);
      }
      // Tire temperatures stay in a plausible band.
      for (const id of ['tire_temp_fl', 'tire_temp_fr', 'tire_temp_rl', 'tire_temp_rr']) {
        const col = c.ch[id]!;
        let peak = -Infinity;
        for (let i = 0; i < c.n; i++) peak = Math.max(peak, col[i]!);
        expect(peak, `${label} ${id}`).toBeLessThanOrEqual(140);
      }
    });
  }
});
