/**
 * The generic headroom rule (Stage 11, Fable finding 5): hints never go silent while the run is
 * off target. It is a `fallback` rule, so it shows only when no fault or headroom rule of the
 * level fired, and only when the run is over the pass line.
 *
 * - Tier 1 names the segment losing most against its floor (`segment_time` against the fastest
 *   any evaluated setup runs that segment).
 * - Tier 3 names the lever with the largest grid-search marginal range at the current setup, and a
 *   direction only, never a value, plus the channel that shows that lever working.
 *
 * "Marginal range at the current setup": for each unlocked lever, the line through the current
 * setup along that lever (every other lever held where the player has it), timed from the grid
 * samples, the same data the debrief's response surface draws. A grid point the search did not
 * evaluate (the coarse → fine search on four-lever levels) is filled by inverse-distance
 * weighting of its nearest evaluated neighbours in lever-step space, as the surface does. Among
 * the levers whose line has a faster point than the current one, the rule picks the largest
 * range and points toward that faster point. If no line improves (a coordinate-wise dip), it
 * falls back to each lever's profile (the best time at each value over every other lever) and
 * points the lever with the largest profile range toward its best value.
 *
 * Needs `ctx.grid`; silent without it.
 */
import type { ChannelId, LeverId, Setup } from '@/engine/types';
import type { LeverSpec, LevelConfig } from '@/levels/types';
import type { RunSummary } from '@/telemetry/types';
import type { HintCtx, HintGrid, HintRule } from './types';

/** Neighbours for the inverse-distance fill. */
const IDW_K = 4;
/** A line point must beat the current one by this much (s) to count as a direction. */
const MIN_GAIN = 1e-3;

/** How tier 3 says each direction, per lever (+1 = raise the lever value). */
export const LEVER_MOVES: Record<LeverId, { up: string; down: string }> = {
  throttle_ramp: { up: 'Lengthen the throttle ramp', down: 'Shorten the throttle ramp' },
  tire_pressure: { up: 'Raise the tire pressure', down: 'Lower the tire pressure' },
  weight_dist: {
    up: 'Move weight distribution toward the rear',
    down: 'Move weight distribution toward the front',
  },
  wing: { up: 'Raise the wing', down: 'Lower the wing' },
};

/** The channels that show a lever working, in order of preference, per direction. */
const LEVER_CHANNELS: Record<LeverId, { up: ChannelId[]; down: ChannelId[] }> = {
  throttle_ramp: {
    up: ['rear_slip_ratio', 'speed_diff_rl', 'long_g'],
    down: ['long_g', 'rear_slip_ratio', 'throttle'],
  },
  tire_pressure: { up: ['mu_rear', 'grip_used_rear'], down: ['mu_rear', 'grip_used_rear'] },
  weight_dist: {
    up: ['load_rear', 'rear_slip_ratio', 'load_front'],
    down: ['load_front', 'front_slip_ratio', 'load_rear'],
  },
  wing: {
    up: ['corner_min_speed', 'downforce', 'segment_delta'],
    down: ['top_speed', 'drag_force', 'segment_delta'],
  },
};

/** Step values of a lever, built from integers so they are exact. */
function steps(l: LeverSpec): number[] {
  const n = Math.round((l.max - l.min) / l.step);
  return Array.from({ length: n + 1 }, (_, i) => +(l.min + i * l.step).toPrecision(12));
}

/** Nearest step index of `v` on lever `l` (clamped). */
function stepIndex(l: LeverSpec, v: number): number {
  const n = Math.round((l.max - l.min) / l.step);
  return Math.max(0, Math.min(n, Math.round((v - l.min) / l.step)));
}

interface Indexed {
  levers: LeverSpec[];
  points: Array<{ idx: number[]; t: number }>;
  exact: Map<string, number>;
}

const indexCache = new WeakMap<object, Map<LevelConfig, Indexed>>();

/** The finite samples in lever-step space, indexed for exact lookup (cached per samples array). */
function indexed(level: LevelConfig, grid: HintGrid): Indexed {
  let byLevel = indexCache.get(grid.samples);
  if (!byLevel) indexCache.set(grid.samples, (byLevel = new Map<LevelConfig, Indexed>()));
  const hit = byLevel.get(level);
  if (hit) return hit;
  const levers = level.levers.filter((l) => !(l.id in level.lockedLevers));
  const points: Indexed['points'] = [];
  const exact = new Map<string, number>();
  for (const s of grid.samples) {
    if (!Number.isFinite(s.totalTime)) continue;
    const idx = levers.map((l) => stepIndex(l, s.setup[l.id]));
    points.push({ idx, t: s.totalTime });
    const key = idx.join(',');
    const prev = exact.get(key);
    if (prev === undefined || s.totalTime < prev) exact.set(key, s.totalTime);
  }
  const out = { levers, points, exact };
  byLevel.set(level, out);
  return out;
}

/** Time at a grid point: the evaluated sample, or the inverse-distance fill of its neighbours. */
function timeAt(ix: Indexed, idx: number[]): number {
  const e = ix.exact.get(idx.join(','));
  if (e !== undefined) return e;
  const near: Array<{ d: number; t: number }> = [];
  for (const p of ix.points) {
    let d = 0;
    for (let k = 0; k < idx.length; k++) d += (p.idx[k]! - idx[k]!) ** 2;
    near.push({ d, t: p.t });
  }
  near.sort((a, b) => a.d - b.d);
  let w = 0;
  let sum = 0;
  for (const n of near.slice(0, IDW_K)) {
    const wi = 1 / n.d;
    w += wi;
    sum += wi * n.t;
  }
  return w > 0 ? sum / w : NaN;
}

export interface HeadroomPick {
  lever: LeverId;
  /** +1 raise the lever value, −1 lower it. */
  dir: 1 | -1;
  /** s: the lever's marginal range used to pick it. */
  range: number;
}

/** The lever (and direction) the grid says still moves the time most from `setup`, or null. */
export function headroomLever(
  level: LevelConfig,
  setup: Setup,
  grid: HintGrid,
): HeadroomPick | null {
  const ix = indexed(level, grid);
  if (ix.levers.length === 0 || ix.points.length === 0) return null;
  const cur = ix.levers.map((l) => stepIndex(l, setup[l.id]));
  let pick: HeadroomPick | null = null;
  ix.levers.forEach((l, k) => {
    const line = steps(l).map((_, i) => {
      const idx = [...cur];
      idx[k] = i;
      return timeAt(ix, idx);
    });
    const tCur = line[cur[k]!]!;
    let best = cur[k]!;
    line.forEach((t, i) => {
      if (t < line[best]! - 1e-9) best = i;
    });
    if (!(tCur - line[best]! > MIN_GAIN)) return;
    const range = Math.max(...line) - Math.min(...line);
    if (!pick || range > pick.range) pick = { lever: l.id, dir: best > cur[k]! ? 1 : -1, range };
  });
  if (pick) return pick;
  // A coordinate-wise dip: fall back to each lever's profile over every other lever.
  ix.levers.forEach((l, k) => {
    const prof = steps(l).map(() => Infinity);
    for (const p of ix.points) prof[p.idx[k]!] = Math.min(prof[p.idx[k]!]!, p.t);
    const finite = prof.filter((t) => Number.isFinite(t));
    if (finite.length < 2) return;
    let best = 0;
    prof.forEach((t, i) => {
      if (t < prof[best]!) best = i;
    });
    if (best === cur[k]) return;
    const range = Math.max(...finite) - Math.min(...finite);
    if (!pick || range > pick.range) pick = { lever: l.id, dir: best > cur[k]! ? 1 : -1, range };
  });
  return pick;
}

/** The segment losing most against its floor this run. */
function worstSegment(ctx: HintCtx, grid: HintGrid): { label: string; loss: number } | null {
  let out: { label: string; loss: number } | null = null;
  ctx.outcome.segmentTimes.forEach((t, i) => {
    const floor = grid.segmentFloors[i];
    if (floor === undefined || !Number.isFinite(floor)) return;
    const loss = t - floor;
    if (!out || loss > out.loss) {
      out = { label: ctx.level.track.segments[i]?.label.toLowerCase() ?? `segment ${i + 1}`, loss };
    }
  });
  return out;
}

function match(s: RunSummary, ctx: HintCtx) {
  const grid = ctx.grid;
  if (!grid || !ctx.outcome.finished) return null;
  const over = ctx.outcome.totalTime - grid.target;
  if (!(over > 0)) return null;
  const pick = headroomLever(ctx.level, ctx.setup, grid);
  if (!pick) return null;
  const dir = pick.dir > 0 ? 'up' : 'down';
  const ch =
    LEVER_CHANNELS[pick.lever][dir].find((c) => ctx.level.channelSet.includes(c)) ?? 'segment_time';
  const seg = worstSegment(ctx, grid);
  const t = s.clean.segment_time;
  return {
    pick,
    vars: {
      over,
      seg: seg?.label ?? 'run',
      loss: seg?.loss ?? over,
      move: LEVER_MOVES[pick.lever][dir],
      ch,
    },
    ...(t
      ? { window: { channel: 'segment_time' as ChannelId, tStart: t.tMin, tEnd: t.tMax } }
      : {}),
    channels: ['segment_time', ch] as ChannelId[],
  };
}

/** The generic headroom rule; add it last to a level's `hintRules`. */
export function setupHeadroomRule(): HintRule {
  return {
    id: 'setup_headroom',
    kind: 'headroom',
    fallback: true,
    when(s, ctx) {
      const m = match(s, ctx);
      if (!m) return null;
      return {
        ruleId: 'setup_headroom',
        vars: m.vars,
        ...(m.window ? { window: m.window } : {}),
        channels: m.channels,
      };
    },
    estTimeCost(_s, ctx) {
      const g = ctx.grid;
      return g ? Math.max(0, ctx.outcome.totalTime - g.target) : 0;
    },
    tiers: [
      '`segment_time` shows the {seg} losing most, {loss:time} slower than the fastest any setup runs it, and the run finished {over:time} over the target with no fault to point at.',
      'Nothing slid, locked or ran out of grip in a way one rule can name, so the time left is in how the levers share grip and drag across the run. Of your levers, one still moves the time far more than the others from where they sit now.',
      '{move}, and watch {ch:channel}.',
    ],
  };
}
