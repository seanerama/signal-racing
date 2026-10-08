/**
 * "Following a hint one step never makes the next run slower" (Stage 11, A2 acceptance): at every
 * point of a level's lever grid, play the run, take every fired rule's tier-3 direction (or only
 * the top-ranked one), apply it one lever step, and compare the next run's time.
 */
import { simulate } from '@/engine/index';
import type { Setup } from '@/engine/types';
import { renderTier, ruleFor } from '@/hints/engine';
import type { LevelConfig } from '@/levels/types';
import type { GridResult } from '@/worker/types';
import { buildSimInput } from '@/worker/build-input';
import { parseDirection, playRun } from './hint-bot';

export interface OneStepViolation {
  setup: Partial<Setup>;
  rule: string;
  top: boolean;
  direct: string;
  from: number;
  to: number;
}

function gridPoints(level: LevelConfig): Array<Partial<Setup>> {
  let pts: Array<Partial<Setup>> = [{}];
  for (const l of level.levers) {
    const n = Math.round((l.max - l.min) / l.step);
    const vals = Array.from({ length: n + 1 }, (_, i) => +(l.min + i * l.step).toPrecision(12));
    pts = pts.flatMap((p) => vals.map((v) => ({ ...p, [l.id]: v })));
  }
  return pts;
}

/** Every (setup, fired rule) whose one-step move makes the next run slower. */
export function oneStepViolations(level: LevelConfig, grid: GridResult): OneStepViolation[] {
  const out: OneStepViolation[] = [];
  const time = (s: Partial<Setup>): number =>
    simulate(buildSimInput(level, s, 2), 'fast').outcome.totalTime;
  for (const setup of gridPoints(level)) {
    const r = playRun(level, grid, setup, 1);
    if (r.outcome.totalTime <= grid.target) continue; // already passing: nothing to follow
    r.hints.forEach((h, i) => {
      const rule = ruleFor(level, h)!;
      if (rule.kind === 'noise') return;
      const direct = renderTier(rule, h, 2, 'metric').text;
      const move = parseDirection(direct);
      const spec = move && level.levers.find((l) => l.id === move.lever);
      if (!move || !spec) return;
      const next = +(setup[move.lever]! + move.dir * spec.step).toPrecision(12);
      if (next < spec.min - 1e-9 || next > spec.max + 1e-9) {
        out.push({
          setup,
          rule: h.ruleId,
          top: i === 0,
          direct,
          from: r.outcome.totalTime,
          to: NaN,
        });
        return;
      }
      const to = time({ ...setup, [move.lever]: next });
      if (to > r.outcome.totalTime + 1e-6) {
        out.push({ setup, rule: h.ruleId, top: i === 0, direct, from: r.outcome.totalTime, to });
      }
    });
  }
  return out;
}
