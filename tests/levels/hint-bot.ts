/**
 * The hint-follower bot (Stage 11): plays a level the way a first-time player who only follows
 * hints would, and reports the runs it took to reach the target.
 *
 * What it may read is exactly what the player sees:
 * - the level's lever specs (range, step, default: the setup panel);
 * - after each run, pass or fail (the result header);
 * - the top-ranked hint's tier-3 text, rendered (the hint popover only ever offers the top rule).
 *
 * It never reads the grid optimum, the samples or any rule internals. The grid result is handed to
 * the hint engine (as the session does), because the hint rules, not the bot, read it.
 *
 * Each run it applies the tier-3 direction one lever step. On the noise rule ("make a bigger
 * change to one lever, or repeat the setup") it repeats its last move one more step, or the setup
 * if it has none. It stops, stuck, when no hint fires, the text names no lever it can parse, or the
 * direction would leave the lever's range.
 */
import { readFileSync } from 'node:fs';
import { simulate } from '@/engine/index';
import { gridKey } from '@/game/config-hash';
import { gridSearch } from '@/game/grid-search';
import { decodePrecomputed } from '@/game/precomputed';
import type { LeverId, Outcome, PhysicalColumns, Setup } from '@/engine/types';
import { evaluateHints, renderTier, ruleFor, type NoiseCtx } from '@/hints/engine';
import type { LevelConfig } from '@/levels/types';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { summarize } from '@/telemetry/summary';
import type { RunSummary } from '@/telemetry/types';
import type { GridResult } from '@/worker/types';
import { buildSimInput, effectiveSetup } from '@/worker/build-input';

export interface BotRun {
  run: number;
  setup: Setup;
  time: number;
  passed: boolean;
  rule?: string;
  direct?: string;
  move?: string;
}

export interface BotResult {
  runs: BotRun[];
  /** 1-based run on which the target was first met, or null. */
  passedAt: number | null;
  stuck?: string;
}

export interface Move {
  lever: LeverId;
  dir: 1 | -1;
}

/** Lever and direction from a tier-3 text, the way a reader would take it. */
export function parseDirection(text: string): Move | null {
  const t = text.toLowerCase();
  if (/throttle ramp/.test(t)) {
    if (/^\s*shorten/.test(t)) return { lever: 'throttle_ramp', dir: -1 };
    if (/^\s*lengthen/.test(t)) return { lever: 'throttle_ramp', dir: 1 };
  }
  if (/tire pressure/.test(t)) {
    if (/^\s*raise/.test(t)) return { lever: 'tire_pressure', dir: 1 };
    if (/^\s*lower/.test(t)) return { lever: 'tire_pressure', dir: -1 };
  }
  if (/weight distribution/.test(t)) {
    if (/toward the rear/.test(t)) return { lever: 'weight_dist', dir: 1 };
    if (/toward the front/.test(t)) return { lever: 'weight_dist', dir: -1 };
  }
  if (/\bwing\b/.test(t)) {
    if (/^\s*raise/.test(t)) return { lever: 'wing', dir: 1 };
    if (/^\s*lower/.test(t)) return { lever: 'wing', dir: -1 };
  }
  return null;
}

/** The game's pass rule (contract 06): total time, or B1L's compromise gap. */
export function passes(level: LevelConfig, outcome: Outcome, grid: GridResult): boolean {
  if (!outcome.finished) return false;
  if (level.scoreTarget === 'compromise_gap') {
    const floors = grid.segmentFloors.reduce((a, b) => a + b, 0);
    const opt = grid.optimum.outcome.totalTime;
    return outcome.totalTime - floors <= opt - floors + 0.005 * opt;
  }
  return outcome.totalTime <= grid.target;
}

/** One player run (index ≥ 1), as the session builds it: telemetry, summary and ranked hints. */
export function playRun(
  level: LevelConfig,
  grid: GridResult,
  setup: Partial<Setup>,
  runIndex: number,
  history: { best?: { outcome: Outcome; physical: PhysicalColumns }; previous?: Outcome } = {},
) {
  const input = buildSimInput(level, setup, runIndex);
  const { outcome, columns } = simulate(input, 'full');
  const telemetry = createRunTelemetry({
    physical: columns!,
    channelIds: [...level.channelSet],
    seed: input.seed,
    ...(history.best ? { best: history.best.physical } : {}),
    segmentFloors: grid.segmentFloors,
  });
  const summary: RunSummary = summarize(telemetry);
  const ctx: NoiseCtx = {
    level,
    setup: effectiveSetup(level, setup),
    outcome,
    grid,
    ...(history.best ? { bestOutcome: history.best.outcome } : {}),
    ...(history.previous ? { previousOutcome: history.previous } : {}),
  };
  const hints = evaluateHints(level, summary, ctx);
  return { outcome, physical: columns!, summary, hints };
}

const round = (x: number): number => +x.toPrecision(12);

/** Plays `level` from its defaults by following the top hint's tier 3, one lever step per run. */
export function followHints(level: LevelConfig, grid: GridResult, maxRuns = 12): BotResult {
  const setup: Partial<Setup> = {};
  for (const l of level.levers) setup[l.id] = l.default;
  const runs: BotRun[] = [];
  let best: { outcome: Outcome; physical: PhysicalColumns; score: number } | undefined;
  let previous: Outcome | undefined;
  let last: Move | null = null;
  const floors = grid.segmentFloors.reduce((a, b) => a + b, 0);
  const scoreOf = (o: Outcome): number =>
    !o.finished
      ? Infinity
      : level.scoreTarget === 'compromise_gap'
        ? o.totalTime - floors
        : o.totalTime;

  for (let run = 1; run <= maxRuns; run++) {
    const r = playRun(level, grid, setup, run, {
      ...(best ? { best } : {}),
      ...(previous ? { previous } : {}),
    });
    const rec: BotRun = {
      run,
      setup: effectiveSetup(level, setup),
      time: r.outcome.totalTime,
      passed: passes(level, r.outcome, grid),
    };
    runs.push(rec);
    if (rec.passed) return { runs, passedAt: run };
    const score = scoreOf(r.outcome);
    if (!best || score < best.score) best = { outcome: r.outcome, physical: r.physical, score };
    previous = r.outcome;

    const top = r.hints[0];
    if (!top) return { runs, passedAt: null, stuck: `run ${run}: no hint fired` };
    const rule = ruleFor(level, top)!;
    const direct = renderTier(rule, top, 2, 'metric').text;
    rec.rule = top.ruleId;
    rec.direct = direct;
    let move: Move | null;
    if (rule.kind === 'noise') {
      move = last;
      if (!move) {
        rec.move = 'repeat the setup';
        continue;
      }
    } else {
      move = parseDirection(direct);
    }
    if (!move) return { runs, passedAt: null, stuck: `run ${run}: cannot read "${direct}"` };
    const spec = level.levers.find((l) => l.id === move.lever);
    if (!spec) return { runs, passedAt: null, stuck: `run ${run}: ${move.lever} is locked` };
    const next = round(setup[move.lever]! + move.dir * spec.step);
    if (next < spec.min - 1e-9 || next > spec.max + 1e-9) {
      return { runs, passedAt: null, stuck: `run ${run}: "${direct}" leaves the lever range` };
    }
    setup[move.lever] = next;
    rec.move = `${move.lever} ${move.dir > 0 ? '+' : '−'}1 → ${next}`;
    last = move;
  }
  return { runs, passedAt: null, stuck: `no pass in ${maxRuns} runs` };
}

const gridMemo = new Map<string, GridResult>();

/**
 * The level's grid result: the build's precomputed entry when its key matches the current config
 * (the slow test recomputes those bit for bit), else a live search. Memoised per level.
 */
export function gridFor(level: LevelConfig): GridResult {
  const key = gridKey(level);
  let g = gridMemo.get(key);
  if (!g) {
    const url = new URL('../../src/game/precomputed-targets.json', import.meta.url);
    const table = decodePrecomputed(JSON.parse(readFileSync(url, 'utf8')));
    g = table[key] ?? gridSearch(level);
    gridMemo.set(key, g);
  }
  return g;
}

/** A one-line trace per run, for test output and the stage report. */
export function describeRuns(r: BotResult): string {
  return r.runs
    .map(
      (x) =>
        `  run ${x.run} ${JSON.stringify(x.setup)} ${x.time.toFixed(3)}${x.passed ? ' PASS' : ''}` +
        (x.rule ? ` | ${x.rule}: ${x.direct} → ${x.move ?? '-'}` : ''),
    )
    .join('\n');
}
