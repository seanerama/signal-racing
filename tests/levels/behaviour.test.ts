/**
 * Level behaviour against the engine (contract 04 validation): for each level the grid optimum
 * passes, the optimum fires no fault rule, and a crafted bad setup fires its target rule. A2 and
 * A3 have an interior optimum; A4's optimum wing is ≥ 5.
 *
 * Pending Stage 2b: on the pre-2b engine (no slide hysteresis) a brief launch spin costs almost
 * nothing, so the A3 and A4 grid optima launch with no ramp and fire `launch_spin` / `wheelspin`.
 * With 2b's hysteresis (spin persists until demand falls) and 5.8 kN they fire nothing (checked on
 * the 2b WIP engine during Stage 6). Those two "optimum fires no fault" assertions are marked
 * `// pending stage 2b` and are expected to pass once 2b is merged.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '@/engine/index';
import type { Setup } from '@/engine/types';
import { gridSearch } from '@/game/grid-search';
import { evaluateHints, renderTier } from '@/hints/engine';
import type { HintMatch } from '@/hints/types';
import { A1, A2, A3, A4, LEVELS } from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { summarize } from '@/telemetry/summary';
import type { GridResult } from '@/worker/types';
import { buildSimInput } from '@/worker/build-input';

const grids = new Map<string, GridResult>();
function grid(level: LevelConfig): GridResult {
  let g = grids.get(level.id);
  if (!g) {
    g = gridSearch(level);
    grids.set(level.id, g);
  }
  return g;
}

/** A player run (run index 1) → its outcome and the hints that fire on it. */
function play(level: LevelConfig, setup: Partial<Setup>) {
  const input = buildSimInput(level, setup, 1);
  const { outcome, columns } = simulate(input, 'full');
  const rt = createRunTelemetry({
    physical: columns!,
    channelIds: [...level.channelSet],
    seed: input.seed,
    segmentFloors:
      level.phase === 'B' ? grid(level).segmentFloors : level.track.segments.map(() => 0),
  });
  const summary = summarize(rt);
  const hints = evaluateHints(level, summary, { level, setup: input.setup, outcome });
  return { outcome, hints, ids: hints.map((h) => h.ruleId) };
}

const faultIds = (level: LevelConfig, hints: HintMatch[]): string[] =>
  hints
    .filter((h) => level.hintRules.find((r) => r.id === h.ruleId)?.kind === 'fault')
    .map((h) => h.ruleId);

const interior = (level: LevelConfig, setup: Setup, id: keyof Setup): boolean => {
  const l = level.levers.find((x) => x.id === id)!;
  return setup[id] > l.min + 1e-9 && setup[id] < l.max - 1e-9;
};

describe.each(LEVELS.map((l) => [l.id, l] as const))('%s behaviour', (id, level) => {
  it('the grid optimum, run as a player run, meets the target', { timeout: 60_000 }, () => {
    const g = grid(level);
    const { outcome } = play(level, g.optimum.setup);
    expect(outcome.finished).toBe(true);
    expect(outcome.totalTime).toBeLessThanOrEqual(g.target);
  });

  it('the optimum fires no fault rule', { timeout: 60_000 }, () => {
    const g = grid(level);
    const { hints } = play(level, g.optimum.setup);
    // pending stage 2b (A3, A4): the pre-2b engine makes a no-ramp launch spin optimal.
    expect(faultIds(level, hints), `${id} optimum ${JSON.stringify(g.optimum.setup)}`).toEqual([]);
  });

  it(
    'every fired rule renders all three tiers with every variable filled',
    { timeout: 60_000 },
    () => {
      const crafted = CRAFTED[id];
      for (const [setup] of crafted) {
        const { hints } = play(level, setup);
        for (const h of hints) {
          const rule = level.hintRules.find((r) => r.id === h.ruleId)!;
          for (const units of ['metric', 'imperial'] as const) {
            for (const tier of [0, 1, 2] as const) {
              const t = renderTier(rule, h, tier, units);
              expect(t.text, `${h.ruleId} tier ${tier + 1}`).not.toMatch(/—|NaN|undefined|\{/);
            }
          }
        }
      }
    },
  );
});

/** Crafted bad setups and the rule each must fire. */
const CRAFTED = {
  A1: [[{ throttle_ramp: 1.0 }, 'ramp_headroom']],
  A2: [
    [{ throttle_ramp: 0, tire_pressure: 1.9 }, 'wheelspin'],
    [{ throttle_ramp: 0.2, tire_pressure: 1.2 }, 'pressure_off_peak'],
    [{ throttle_ramp: 1.4, tire_pressure: 1.6 }, 'ramp_too_gentle'],
  ],
  A3: [
    [{ throttle_ramp: 0.2, tire_pressure: 1.6, weight_dist: 0.38 }, 'launch_spin'],
    [{ throttle_ramp: 0.6, tire_pressure: 1.6, weight_dist: 0.52 }, 'front_lock'],
  ],
  A4: [
    [{ throttle_ramp: 0.4, tire_pressure: 1.6, weight_dist: 0.46, wing: 1 }, 'corner_grip_limited'],
    [{ throttle_ramp: 0, tire_pressure: 2.2, weight_dist: 0.4, wing: 4 }, 'wheelspin'],
  ],
  B1L: [
    [{ throttle_ramp: 0, tire_pressure: 1.6, weight_dist: 0.52, wing: 7 }, 'segment_paying'],
    [{ throttle_ramp: 0, tire_pressure: 1.6, weight_dist: 0.52, wing: 1 }, 'segment_paying'],
    [{ throttle_ramp: 0, tire_pressure: 1.6, weight_dist: 0.52, wing: 1 }, 'corner_grip_limited'],
    [{ throttle_ramp: 0, tire_pressure: 2.2, weight_dist: 0.4, wing: 3 }, 'wheelspin'],
  ],
  B4L: [
    [{ throttle_ramp: 0.4, tire_pressure: 1.7, weight_dist: 0.46, wing: 7 }, 'segment_paying'],
    [{ throttle_ramp: 0, tire_pressure: 1.6, weight_dist: 0.52, wing: 0 }, 'front_lock'],
    [{ throttle_ramp: 0, tire_pressure: 2.2, weight_dist: 0.4, wing: 3 }, 'wheelspin'],
    [{ throttle_ramp: 0, tire_pressure: 1.2, weight_dist: 0.52, wing: 3 }, 'pressure_off_peak'],
    [{ throttle_ramp: 1.4, tire_pressure: 1.6, weight_dist: 0.52, wing: 3 }, 'ramp_too_gentle'],
  ],
} satisfies Record<string, Array<[Partial<Setup>, string]>>;

describe('crafted bad setups fire their rule', () => {
  for (const [id, cases] of Object.entries(CRAFTED)) {
    const level = LEVELS.find((l) => l.id === id)!;
    for (const [setup, rule] of cases) {
      it(`${id} ${JSON.stringify(setup)} → ${rule}`, () => {
        expect(play(level, setup).ids).toContain(rule);
      });
    }
  }

  it('A1 drag_bend teaches the first run only', () => {
    const first = play(A1, { throttle_ramp: 0 });
    expect(first.ids).toEqual(['drag_bend']);
  });

  it('A4 drag_cost fires at the top of the wing range when the run-out is slower than the best', () => {
    const input = buildSimInput(A4, { wing: 8, weight_dist: 0.46, throttle_ramp: 0.4 }, 1);
    const { outcome, columns } = simulate(input, 'full');
    const rt = createRunTelemetry({
      physical: columns!,
      channelIds: [...A4.channelSet],
      seed: input.seed,
      segmentFloors: [0, 0, 0],
    });
    const best = { ...outcome, segmentTimes: outcome.segmentTimes.map((t) => t - 0.05) };
    const hints = evaluateHints(A4, summarize(rt), {
      level: A4,
      setup: input.setup,
      outcome,
      bestOutcome: best,
    });
    expect(hints.map((h) => h.ruleId)).toContain('drag_cost');
  });
});

describe('optimum shape', () => {
  it('A2 has an interior optimum (ramp and pressure)', { timeout: 60_000 }, () => {
    const s = grid(A2).optimum.setup;
    expect(interior(A2, s, 'throttle_ramp'), JSON.stringify(s)).toBe(true);
    expect(interior(A2, s, 'tire_pressure'), JSON.stringify(s)).toBe(true);
  });

  it('A3 has an interior weight-distribution optimum', { timeout: 60_000 }, () => {
    const s = grid(A3).optimum.setup;
    expect(interior(A3, s, 'weight_dist'), JSON.stringify(s)).toBe(true);
  });

  it("A4's optimum wing is at least 5", { timeout: 60_000 }, () => {
    expect(grid(A4).optimum.setup.wing).toBeGreaterThanOrEqual(5);
  });

  it('A1: no grip limit, so no ramp is best', () => {
    expect(grid(A1).optimum.setup.throttle_ramp).toBe(0);
  });
});
