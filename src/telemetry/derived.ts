/**
 * Derived ("math") channels: computed by the logger from other channels, as a MoTeC/ATLAS math
 * channel would be. Contract 03 plus `corner_min_speed` and `exit_speed`.
 *
 * Noise: derived channels add no noise of their own (`NO_NOISE`). `RunTelemetry.get()` evaluates
 * them over the *noisy* inputs, so sensor-based math channels (`speed_diff_*`, `top_speed`,
 * `corner_min_speed`, `exit_speed`) inherit the noise and dropouts of the sensors they read, while
 * the timing channels (`delta_best`, `segment_time`, `segment_delta`) depend only on `t`, `s`, `seg`
 * and stay exact. `getClean()` evaluates them over the clean inputs.
 */
import type { ChannelId, PhysicalColumns } from '@/engine/types';
import { NO_NOISE, type RegisteredChannel } from './def';
import type { ChannelDef, DeriveCtx } from './types';

/** Reads a physical column, or `undefined` when the run does not carry it. */
function col(run: PhysicalColumns, id: ChannelId): Float32Array | undefined {
  return run.ch[id];
}

function requireCol(run: PhysicalColumns, id: ChannelId): Float32Array {
  const c = run.ch[id];
  if (!c)
    throw new Error(`derived channel needs physical channel '${id}', which the run does not carry`);
  return c;
}

/** Number of segments in a run (max `seg` + 1; 0 for an empty run). */
export function segmentCount(run: { n: number; seg: Uint8Array }): number {
  let max = -1;
  for (let i = 0; i < run.n; i++) if (run.seg[i]! > max) max = run.seg[i]!;
  return max + 1;
}

/** Index of the first sample of each segment (−1 if a segment has no samples). */
export function segmentStartIndices(run: { n: number; seg: Uint8Array }): number[] {
  const starts: number[] = new Array<number>(segmentCount(run)).fill(-1);
  for (let i = 0; i < run.n; i++) {
    const k = run.seg[i]!;
    if (starts[k] === -1) starts[k] = i;
  }
  return starts;
}

/** s: time of the first sample of each segment (`DeriveCtx.segmentStartTimes`). */
export function segmentStartTimes(run: PhysicalColumns): number[] {
  const idx = segmentStartIndices(run);
  let last = 0;
  return idx.map((i) => (i >= 0 ? (last = run.t[i]!) : last));
}

/**
 * `delta_best`: time delta against the best run, aligned by distance. At each sample, the time the
 * best run reached this sample's `s` (linear interpolation) is subtracted from this run's `t`.
 * Positive = slower than best. Zero everywhere when there is no best run yet (this run is the best).
 *
 * Stationary samples (a plateau in `s`: the launch, a stop) are matched sample-for-sample against
 * the best run's plateau at the same `s`, so an identical run gives exactly 0 and time spent
 * standing longer than the best did shows up as a growing delta.
 */
export function computeDeltaBest(ctx: DeriveCtx): Float32Array {
  const { run, best } = ctx;
  const out = new Float32Array(run.n);
  if (!best || best.n === 0) return out;
  const bs = best.s;
  const bt = best.t;
  const nb = best.n;
  let j = 0; // first best index with bs[j] >= si (only moves forward: run s is non-decreasing)
  let plateauEnd = -1; // last best index of the plateau starting at j (cached per j)
  let plateauFor = -1;
  let m = 0; // how many earlier run samples share this sample's s
  for (let i = 0; i < run.n; i++) {
    const si = run.s[i]!;
    m = i > 0 && run.s[i - 1] === si ? m + 1 : 0;
    while (j < nb && bs[j]! < si) j++;
    let tb: number;
    if (j >= nb) tb = bt[nb - 1]!;
    else if (bs[j] === si) {
      if (plateauFor !== j) {
        plateauFor = j;
        plateauEnd = j;
        while (plateauEnd + 1 < nb && bs[plateauEnd + 1] === si) plateauEnd++;
      }
      tb = bt[Math.min(j + m, plateauEnd)]!;
    } else if (j === 0) tb = bt[0]!;
    else {
      const s0 = bs[j - 1]!;
      const s1 = bs[j]!;
      tb = bt[j - 1]! + ((si - s0) / (s1 - s0)) * (bt[j]! - bt[j - 1]!);
    }
    out[i] = run.t[i]! - tb;
  }
  return out;
}

/** `segment_time`: running time within the current segment. */
export function computeSegmentTime(ctx: DeriveCtx): Float32Array {
  const { run, segmentStartTimes: starts } = ctx;
  const out = new Float32Array(run.n);
  for (let i = 0; i < run.n; i++) out[i] = run.t[i]! - (starts[run.seg[i]!] ?? 0);
  return out;
}

/**
 * `segment_delta`: time lost against the segment floor, cumulative within each segment.
 * `segment_time × (1 − floor / T)`, where `T` is this run's time for the segment: the segment's
 * loss `T − floor` accrues in proportion to the run's own elapsed time in it. So it is 0 at every
 * segment start, reaches `T − floor` at each segment end, and is monotone in between, so the value
 * at each dashed boundary reads straight off the strip.
 *
 * Stage 8 change: Stage 3 accrued the floor by distance (`segment_time − floor × s-progress`). On
 * a standing-start straight that draws a multi-second hump mid-segment (the car covers the first
 * metres slowly, and a distance-proportional floor assumes it does not), which swamped the
 * compromise the B1L strip exists to show. Endpoints are unchanged.
 *
 * All-NaN when the level has no segment floors (only join levels have them).
 */
export function computeSegmentDelta(ctx: DeriveCtx): Float32Array {
  const { run, segmentFloors, segmentStartTimes: starts } = ctx;
  const out = new Float32Array(run.n);
  if (!segmentFloors) return out.fill(NaN);
  const segTime = computeSegmentTime(ctx);
  const k = starts.length;
  // Each segment's duration on this run: the next segment's start, or the last sample.
  const tEnd = run.n > 0 ? run.t[run.n - 1]! : 0;
  const duration = starts.map((t0, seg) => (seg + 1 < k ? starts[seg + 1]! : tEnd) - t0);
  for (let i = 0; i < run.n; i++) {
    const seg = run.seg[i]!;
    const floor = segmentFloors[seg];
    const T = duration[seg];
    if (floor === undefined || T === undefined) {
      out[i] = NaN;
      continue;
    }
    // `+ 0` normalises −0 (a segment start on a run faster than its floor).
    out[i] = T > 0 ? segTime[i]! * (1 - floor / T) + 0 : 0;
  }
  return out;
}

/** Wheel speed minus ground speed for one wheel (positive = wheelspin, negative = lock). */
function speedDiff(wheelId: ChannelId) {
  return (ctx: DeriveCtx): Float32Array => {
    const wheel = requireCol(ctx.run, wheelId);
    const speed = requireCol(ctx.run, 'speed');
    const out = new Float32Array(ctx.run.n);
    for (let i = 0; i < ctx.run.n; i++) out[i] = wheel[i]! - speed[i]!;
    return out;
  };
}

/** `top_speed`: running maximum of ground speed (NaN samples are skipped; NaN until the first valid one). */
export function computeTopSpeed(ctx: DeriveCtx): Float32Array {
  const speed = requireCol(ctx.run, 'speed');
  const out = new Float32Array(ctx.run.n);
  let max = NaN;
  for (let i = 0; i < ctx.run.n; i++) {
    const v = speed[i]!;
    if (!Number.isNaN(v) && !(v <= max)) max = v;
    out[i] = max;
  }
  return out;
}

/** m/s: a segment whose mean `corner_limit_speed` exceeds this is a corner (robust to sensor noise). */
const CORNER_DETECT_SPEED = 1;

/**
 * Which segments are corners. Contract 02: `corner_limit_speed` is the corner's v_lim inside a
 * corner and 0 on straights. A segment is a corner when the mean of that channel over the segment
 * (NaN skipped) exceeds 1 m/s, which works on the noisy series too. Runs without the column have
 * no corners.
 */
export function cornerSegments(run: PhysicalColumns): boolean[] {
  const k = segmentCount(run);
  const flags = new Array<boolean>(k).fill(false);
  const lim = col(run, 'corner_limit_speed');
  if (!lim) return flags;
  const sum = new Array<number>(k).fill(0);
  const cnt = new Array<number>(k).fill(0);
  for (let i = 0; i < run.n; i++) {
    const v = lim[i]!;
    if (Number.isNaN(v)) continue;
    sum[run.seg[i]!]! += v;
    cnt[run.seg[i]!]!++;
  }
  for (let j = 0; j < k; j++) flags[j] = cnt[j]! > 0 && sum[j]! / cnt[j]! > CORNER_DETECT_SPEED;
  return flags;
}

/** `corner_min_speed`: running minimum speed within the current corner segment; NaN on straights. */
export function computeCornerMinSpeed(ctx: DeriveCtx): Float32Array {
  const { run } = ctx;
  const speed = requireCol(run, 'speed');
  const corner = cornerSegments(run);
  const out = new Float32Array(run.n);
  let curSeg = -1;
  let min = NaN;
  for (let i = 0; i < run.n; i++) {
    const seg = run.seg[i]!;
    if (!corner[seg]) {
      out[i] = NaN;
      curSeg = -1;
      continue;
    }
    if (seg !== curSeg) {
      curSeg = seg;
      min = NaN;
    }
    const v = speed[i]!;
    if (!Number.isNaN(v) && !(v >= min)) min = v;
    out[i] = min;
  }
  return out;
}

/**
 * `exit_speed`: speed at the last sample of each corner segment, held from there until the next
 * corner's exit replaces it. NaN before the first corner exit (and on runs without corners).
 * A dropout on the exit sample falls back to the nearest earlier valid sample in that corner.
 */
export function computeExitSpeed(ctx: DeriveCtx): Float32Array {
  const { run } = ctx;
  const speed = requireCol(run, 'speed');
  const corner = cornerSegments(run);
  const out = new Float32Array(run.n);
  let held = NaN;
  let lastValidInCorner = NaN;
  for (let i = 0; i < run.n; i++) {
    const seg = run.seg[i]!;
    if (corner[seg]) {
      const v = speed[i]!;
      if (!Number.isNaN(v)) lastValidInCorner = v;
      const isLast = i === run.n - 1 || run.seg[i + 1] !== seg;
      if (isLast) {
        held = lastValidInCorner;
        lastValidInCorner = NaN;
      }
    }
    out[i] = held;
  }
  return out;
}

const derived = (
  id: ChannelId,
  label: string,
  quantity: ChannelDef['quantity'],
  group: ChannelDef['group'],
  range: readonly [number, number],
  compute: (ctx: DeriveCtx) => Float32Array,
): RegisteredChannel => ({
  id,
  label,
  quantity,
  group,
  source: { kind: 'derived', compute },
  noise: NO_NOISE,
  range,
});

export const DERIVED_DEFS: readonly RegisteredChannel[] = [
  derived('delta_best', 'Delta to best run', 'time', 'timing', [-5, 5], computeDeltaBest),
  derived('segment_time', 'Segment time', 'time', 'timing', [0, 120], computeSegmentTime),
  derived(
    'segment_delta',
    'Segment delta to floor',
    'time',
    'timing',
    [-2, 5],
    computeSegmentDelta,
  ),
  derived('top_speed', 'Top speed', 'speed', 'timing', [0, 90], computeTopSpeed),
  derived(
    'speed_diff_rl',
    'Wheel slip speed rear left',
    'speed',
    'tires',
    [-20, 20],
    speedDiff('wheel_speed_rl'),
  ),
  derived(
    'speed_diff_rr',
    'Wheel slip speed rear right',
    'speed',
    'tires',
    [-20, 20],
    speedDiff('wheel_speed_rr'),
  ),
  derived(
    'corner_min_speed',
    'Corner minimum speed',
    'speed',
    'chassis',
    [0, 90],
    computeCornerMinSpeed,
  ),
  derived('exit_speed', 'Corner exit speed', 'speed', 'chassis', [0, 90], computeExitSpeed),
];
