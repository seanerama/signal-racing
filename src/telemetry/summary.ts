/**
 * Run summary (contract 03): per-channel min/max/mean with their sample indices and times, over the
 * noisy series (what the player sees), the clean series (what hint rules use), and per segment.
 *
 * NaN-safe: dropouts are skipped and counted. An empty or all-NaN series gives NaN stats with
 * `argmin = argmax = −1`. One pass per series: the noisy pass fills the run-wide and per-segment
 * stats together.
 *
 * Stats are cached per run and channel (project-plan decision 3), so the Puzzle's 200-channel table
 * pays for each channel once.
 */
import type { ChannelId } from '@/engine/types';
import { segmentCount } from './derived';
import type { ChannelStats, RunSummary, RunTelemetry } from './types';

interface ChannelEntry {
  stats: ChannelStats;
  clean: ChannelStats;
  perSegment: ChannelStats[];
}

const CACHE = new WeakMap<RunTelemetry, Map<ChannelId, ChannelEntry>>();

/** Mutable accumulator for one series (or one segment of it). */
class Acc {
  min = Infinity;
  max = -Infinity;
  sum = 0;
  count = 0;
  argmin = -1;
  argmax = -1;
  dropouts = 0;

  push(v: number, i: number): void {
    if (Number.isNaN(v)) {
      this.dropouts++;
      return;
    }
    if (v < this.min) {
      this.min = v;
      this.argmin = i;
    }
    if (v > this.max) {
      this.max = v;
      this.argmax = i;
    }
    this.sum += v;
    this.count++;
  }

  done(t: Float32Array): ChannelStats {
    if (this.count === 0) {
      return {
        min: NaN,
        max: NaN,
        mean: NaN,
        argmin: -1,
        argmax: -1,
        tMin: NaN,
        tMax: NaN,
        dropouts: this.dropouts,
      };
    }
    return {
      min: this.min,
      max: this.max,
      mean: this.sum / this.count,
      argmin: this.argmin,
      argmax: this.argmax,
      tMin: t[this.argmin]!,
      tMax: t[this.argmax]!,
      dropouts: this.dropouts,
    };
  }
}

/** Stats of one series, NaN-safe. */
export function channelStats(values: Float32Array, t: Float32Array): ChannelStats {
  const acc = new Acc();
  for (let i = 0; i < values.length; i++) acc.push(values[i]!, i);
  return acc.done(t);
}

function computeEntry(rt: RunTelemetry, id: ChannelId, nSeg: number): ChannelEntry {
  const noisy = rt.get(id);
  const clean = rt.getClean(id);
  const all = new Acc();
  const segs = Array.from({ length: nSeg }, () => new Acc());
  const seg = rt.seg;
  for (let i = 0; i < rt.n; i++) {
    const v = noisy[i]!;
    all.push(v, i);
    segs[seg[i]!]!.push(v, i);
  }
  return {
    stats: all.done(rt.t),
    clean: channelStats(clean, rt.t),
    perSegment: segs.map((a) => a.done(rt.t)),
  };
}

export function summarize(rt: RunTelemetry, opts?: { ids?: ChannelId[] }): RunSummary {
  const ids = opts?.ids ?? rt.channelIds;
  let cache = CACHE.get(rt);
  if (!cache) {
    cache = new Map();
    CACHE.set(rt, cache);
  }
  const nSeg = segmentCount(rt);
  const stats: Record<ChannelId, ChannelStats> = {};
  const clean: Record<ChannelId, ChannelStats> = {};
  const perSegment: Array<Record<ChannelId, ChannelStats>> = Array.from(
    { length: nSeg },
    () => ({}),
  );
  for (const id of ids) {
    let e = cache.get(id);
    if (!e) {
      e = computeEntry(rt, id, nSeg);
      cache.set(id, e);
    }
    stats[id] = e.stats;
    clean[id] = e.clean;
    for (let k = 0; k < nSeg; k++) perSegment[k]![id] = e.perSegment[k]!;
  }
  return {
    stats,
    clean,
    perSegment,
    window(id, pred) {
      const v = rt.getClean(id);
      let first = -1;
      let last = -1;
      for (let i = 0; i < rt.n; i++) {
        const x = v[i]!;
        if (Number.isNaN(x) || !pred(x)) continue;
        if (first < 0) first = i;
        last = i;
      }
      return first < 0 ? null : { tStart: rt.t[first]!, tEnd: rt.t[last]! };
    },
  };
}
