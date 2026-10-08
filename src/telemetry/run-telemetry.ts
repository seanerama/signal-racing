/**
 * Run telemetry (contract 03): lazy, cached, deterministic access to every channel of one run.
 *
 * Nothing is generated at creation (project-plan decision 3). A channel is materialised the first
 * time `get()` / `getClean()` asks for it, then cached; clean and noisy series are cached
 * separately.
 *
 * - physical: clean = `physical.ch[id]`; noisy = clean + noise layer.
 * - distractor: clean = family generator over `(t, s, throttle, speed)` with the stream
 *   `createRng(seed).fork('distractor:' + id)`; noisy = clean + noise layer.
 * - derived: clean = `compute()` over the clean physical columns; noisy = `compute()` over the
 *   noisy physical columns (a math channel inherits its inputs' noise), plus its own noise layer
 *   (zero for the registry's derived channels).
 *
 * The noise stream is `createRng(seed).fork('noise:' + id)`. Returned arrays are shared cache
 * entries: callers must not mutate them.
 *
 * Stage 9: `args.artifacts` (planted sensor artifacts, "Make the call") are applied to `get()`
 * after the noise layer and never to `getClean()`.
 */
import { createRng } from '@/engine/rng';
import type { ChannelId, PhysicalColumns } from '@/engine/types';
import { segmentStartTimes } from './derived';
import { generateDistractor } from './distractors';
import { applyNoise } from './noise';
import { channelQuantum, channelRange, getChannel, inRegistryOrder } from './registry';
import type { CreateRunTelemetryArgs, DeriveCtx, RunTelemetry, SensorArtifact } from './types';

/** Sample index an artifact starts at: first `t ≥ at.t`, else first `s ≥ at.s`, else 0. */
export function artifactIndex(
  run: { n: number; t: ArrayLike<number>; s: ArrayLike<number> },
  at: SensorArtifact['at'],
): number {
  const key = at.t !== undefined ? run.t : at.s !== undefined ? run.s : null;
  const target = at.t ?? at.s;
  if (!key || target === undefined) return 0;
  for (let i = 0; i < run.n; i++) if ((key[i] as number) >= target) return i;
  return Math.max(0, run.n - 1);
}

/**
 * Applies sensor artifacts to a noisy series in place (Stage 9). Deterministic: no randomness.
 * `clean` is the noise-free series, used where the noisy sample is a dropout so the artifact
 * still shows.
 */
export function applyArtifacts(
  out: Float32Array,
  clean: Float32Array,
  run: { n: number; dt: number; t: ArrayLike<number>; s: ArrayLike<number> },
  artifacts: readonly SensorArtifact[],
): void {
  for (const a of artifacts) {
    const i0 = artifactIndex(run, a.at);
    const span =
      a.durationS !== undefined
        ? Math.max(1, Math.round(a.durationS / run.dt))
        : a.kind === 'step'
          ? run.n - i0
          : 1;
    const end = Math.min(run.n, i0 + span);
    const base = (i: number): number => {
      const v = out[i]!;
      return Number.isNaN(v) ? clean[i]! : v;
    };
    const held = base(i0) + a.magnitude;
    for (let i = i0; i < end; i++) out[i] = a.kind === 'stuck' ? held : base(i) + a.magnitude;
  }
}

export function createRunTelemetry(args: CreateRunTelemetryArgs): RunTelemetry {
  const { physical, seed, best, segmentFloors } = args;
  const artifacts = args.artifacts ?? [];
  const root = createRng(seed);
  const channelIds = Object.freeze(inRegistryOrder(args.channelIds));
  const clean = new Map<ChannelId, Float32Array>();
  const noisy = new Map<ChannelId, Float32Array>();
  const starts = segmentStartTimes(physical);
  const zeros = new Float32Array(physical.n);

  const baseCtx = (run: PhysicalColumns): DeriveCtx => ({
    run,
    segmentStartTimes: starts,
    ...(best ? { best } : {}),
    ...(segmentFloors ? { segmentFloors } : {}),
  });

  let noisyColumns: PhysicalColumns | undefined;
  /** The physical columns with every channel read through `get()` (lazily, per column). */
  const noisyRun = (): PhysicalColumns => {
    if (noisyColumns) return noisyColumns;
    const ch: Record<ChannelId, Float32Array> = {};
    for (const id of Object.keys(physical.ch)) {
      Object.defineProperty(ch, id, { enumerable: true, get: () => getNoisy(id) });
    }
    noisyColumns = {
      n: physical.n,
      dt: physical.dt,
      t: physical.t,
      s: physical.s,
      seg: physical.seg,
      ch,
    };
    return noisyColumns;
  };

  function getClean(id: ChannelId): Float32Array {
    const cached = clean.get(id);
    if (cached) return cached;
    const def = getChannel(id);
    let out: Float32Array;
    switch (def.source.kind) {
      case 'physical': {
        const c = physical.ch[id];
        if (!c) throw new Error(`physical channel '${id}' is missing from this run's columns`);
        out = c;
        break;
      }
      case 'derived':
        out = def.source.compute(baseCtx(physical));
        break;
      case 'distractor':
        out = generateDistractor(def.source.family, {
          n: physical.n,
          dt: physical.dt,
          t: physical.t,
          s: physical.s,
          throttle: physical.ch.throttle ?? zeros,
          speed: physical.ch.speed ?? zeros,
          rng: root.fork('distractor:' + id),
          params: def.source.params,
        });
        break;
    }
    clean.set(id, out);
    return out;
  }

  function getNoisy(id: ChannelId): Float32Array {
    const cached = noisy.get(id);
    if (cached) return cached;
    const def = getChannel(id);
    const base =
      def.source.kind === 'derived' ? def.source.compute(baseCtx(noisyRun())) : getClean(id);
    const quantum = channelQuantum(id);
    const out = applyNoise(
      base,
      {
        sigmaFrac: def.noise.sigmaFrac,
        dropoutRate: def.noise.dropoutRate,
        range: channelRange(id),
        ...(quantum !== undefined ? { quantum } : {}),
        ...(def.clamp ? { clamp: def.clamp } : {}),
      },
      root.fork('noise:' + id),
    );
    // Stage 9: planted sensor artifacts, after noise, in the sensor layer only.
    const mine = artifacts.filter((a) => a.channel === id);
    if (mine.length) applyArtifacts(out, getClean(id), physical, mine);
    noisy.set(id, out);
    return out;
  }

  return {
    n: physical.n,
    dt: physical.dt,
    t: physical.t,
    s: physical.s,
    seg: physical.seg,
    channelIds,
    get: getNoisy,
    getClean,
  };
}
