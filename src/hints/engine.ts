/**
 * The generic hint engine (contract 06): evaluate a level's rules on a run summary, rank the
 * matches, render tier templates with unit-aware formatting, and the generic noise rule.
 *
 * Template syntax (contract 04):
 * - `{name}` inserts `vars.name` raw (numbers are trimmed to at most 3 decimals);
 * - `{name:quantity}` formats it with `formatValue(quantity, units, value)` (SI in, display out);
 * - a backticked channel id (`` `rear_slip_ratio` ``) becomes a `channel` segment, so the UI can
 *   render it as a link without re-parsing. The backticks are not part of `text`.
 * - `{name:channel}` (Stage 11) inserts `vars.name` as a `channel` segment: a channel chosen at run
 *   time, rendered exactly like a backticked one.
 */
import { log } from '@/app/log';
import type { Outcome, Quantity } from '@/engine/types';
import type { LevelConfig } from '@/levels/types';
import type { RunSummary } from '@/telemetry/types';
import { QUANTITIES, formatValue, type UnitSystem } from '@/units/index';
import type { HintCtx, HintMatch, HintRule, HintText } from './types';

export type { HintText };

/**
 * `HintCtx` plus the previous run's outcome, which the session passes so the noise rule can
 * compare the last two runs. Other rules may ignore it.
 */
export interface NoiseCtx extends HintCtx {
  previousOutcome?: Outcome;
}

/** Rules that throw are skipped (and logged) rather than failing the run. */
function safe<T>(rule: HintRule, what: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    log.warn(`hint rule ${rule.id}: ${what} threw`, err);
    return fallback;
  }
}

/**
 * Every rule of `level` that fires on this run, ranked by `estTimeCost` descending (ties keep the
 * level's rule order). A `fallback` rule's match is dropped when any fault or headroom rule fired.
 */
export function evaluateHints(level: LevelConfig, summary: RunSummary, ctx: HintCtx): HintMatch[] {
  const fired: Array<{ match: HintMatch; cost: number; order: number; rule: HintRule }> = [];
  level.hintRules.forEach((rule, order) => {
    const match = safe(rule, 'when', () => rule.when(summary, ctx), null);
    if (!match) return;
    const raw = safe(rule, 'estTimeCost', () => rule.estTimeCost(summary, ctx), 0);
    const cost = Number.isFinite(raw) ? raw : 0;
    fired.push({ match: { ...match, ruleId: rule.id }, cost, order, rule });
  });
  const specific = fired.some((f) => !f.rule.fallback && f.rule.kind !== 'noise');
  const kept = specific ? fired.filter((f) => !f.rule.fallback) : fired;
  kept.sort((a, b) => b.cost - a.cost || a.order - b.order);
  return kept.map((f) => f.match);
}

/** Finds the rule a match came from. */
export function ruleFor(level: LevelConfig, match: HintMatch): HintRule | undefined {
  return level.hintRules.find((r) => r.id === match.ruleId);
}

const TOKEN = /`([a-z][a-z0-9_]*)`|\{([A-Za-z_][A-Za-z0-9_]*)(?::([a-z_]+))?\}/g;

function rawValue(v: number | string): string {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return String(v);
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Renders one template against `vars`. Exported for tests and for non-rule text (debrief). */
export function renderTemplate(
  template: string,
  vars: Record<string, number | string>,
  units: UnitSystem,
): HintText {
  const segments: HintText['segments'] = [];
  const pushText = (s: string): void => {
    if (!s) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.value += s;
    else segments.push({ kind: 'text', value: s });
  };
  let at = 0;
  for (const m of template.matchAll(TOKEN)) {
    const idx = m.index;
    pushText(template.slice(at, idx));
    at = idx + m[0].length;
    const [, channel, name, quantity] = m;
    if (channel) {
      segments.push({ kind: 'channel', value: channel });
      continue;
    }
    const v = name !== undefined ? vars[name] : undefined;
    if (quantity === 'channel' && typeof v === 'string') {
      segments.push({ kind: 'channel', value: v });
      continue;
    }
    let value: string;
    if (v === undefined) {
      log.warn(`hint template: no value for {${name ?? ''}}`);
      value = '—';
    } else if (quantity && typeof v === 'number') {
      if ((QUANTITIES as readonly string[]).includes(quantity)) {
        value = formatValue(quantity as Quantity, units, v);
      } else {
        log.warn(`hint template: unknown quantity '${quantity}'`);
        value = rawValue(v);
      }
    } else {
      value = rawValue(v);
    }
    segments.push({ kind: 'value', value });
  }
  pushText(template.slice(at));
  return { text: segments.map((s) => s.value).join(''), segments };
}

/** Renders tier 0 (observe), 1 (explain) or 2 (direct) of `rule` for `match`. */
export function renderTier(
  rule: HintRule,
  match: HintMatch,
  tier: 0 | 1 | 2,
  units: UnitSystem,
): HintText {
  return renderTemplate(rule.tiers[tier], match.vars, units);
}

// ---- Noise rule ----

/**
 * Time elasticity to grip: d(ln T)/d(ln μ) ≈ −0.25 at the optimum on the meeting-cut tracks
 * (measured on the A3/A4/B4L shapes: 0.19–0.26). Used to turn `gripFrac` into a time band.
 */
export const NOISE_GRIP_ELASTICITY = 0.25;

/**
 * σ (s) of the difference between two runs of the same setup, from the level's declared
 * variation: one run's grip factor is `1 + gripFrac·u`, `u ~ U[−1, 1)`, so its time has
 * σ ≈ T·e·gripFrac/√3, and a difference of two independent runs has √2 times that. Track
 * temperature only moves grip when `tempAffectsGrip` is on (off in the meeting cut), so it is
 * ignored. 0 when the level declares no variation.
 */
export function runToRunSigma(
  level: LevelConfig,
  totalTime: number,
  elasticity = NOISE_GRIP_ELASTICITY,
): number {
  const v = level.conditions.variation;
  if (!v || !Number.isFinite(totalTime)) return 0;
  return (Math.SQRT2 * totalTime * elasticity * v.gripFrac) / Math.sqrt(3);
}

/**
 * The generic noise rule (kind `'noise'`): fires when |Δ| between this run and the previous one
 * is less than 2σ of run-to-run variation. Needs `previousOutcome` in the context (the session
 * provides it). Add it to a level's `hintRules` to enable it (B4L in the meeting cut).
 */
export function noiseRule(opts: { id?: string; elasticity?: number } = {}): HintRule {
  const id = opts.id ?? 'noise';
  const band = (ctx: HintCtx): { delta: number; sigma: number } | null => {
    const prev = (ctx as NoiseCtx).previousOutcome;
    if (!prev || !prev.finished || !ctx.outcome.finished) return null;
    const sigma = runToRunSigma(ctx.level, ctx.outcome.totalTime, opts.elasticity);
    if (!(sigma > 0)) return null;
    return { delta: ctx.outcome.totalTime - prev.totalTime, sigma };
  };
  return {
    id,
    kind: 'noise',
    when(s, ctx) {
      const b = band(ctx);
      if (!b || !(Math.abs(b.delta) < 2 * b.sigma)) return null;
      // Stage 11: point at the run's real conditions where the level logs them.
      const set = ctx.level.channelSet;
      const conditions = (['grip_multiplier', 'track_temp'] as const).filter((c) =>
        set.includes(c),
      );
      return {
        ruleId: id,
        vars: {
          delta: Math.abs(b.delta),
          sigma: b.sigma,
          band: 2 * b.sigma,
          grip:
            (s.clean as RunSummary['clean'] | undefined)?.grip_multiplier?.mean ??
            ctx.level.conditions.base.gripMultiplier,
          temp:
            (s.clean as RunSummary['clean'] | undefined)?.track_temp?.mean ??
            ctx.level.conditions.base.trackTemp,
        },
        channels: ['delta_best', ...conditions],
      };
    },
    estTimeCost(_s, ctx) {
      const b = band(ctx);
      return b ? 2 * b.sigma : 0;
    },
    tiers: [
      'This run differs from the last by {delta:time}, inside the run-to-run band of {band:time}; `grip_multiplier` read {grip} and `track_temp` {temp:temperature} this run.',
      'This change is smaller than the track variation between runs. Grip and track temperature move a little every run, and `grip_multiplier` and `track_temp` show by how much, so a difference this small can be the track, not the setup.',
      'Compare runs under like conditions before concluding: make a bigger change to one lever, or repeat the setup.',
    ],
  };
}
