/**
 * Sensor noise layer (project-plan decision 4: noise is a layer, not a role).
 *
 * `noisy[i] = clean[i] + sigmaFrac × (hi − lo) × N(0, 1)`, or NaN with probability `dropoutRate`.
 * Digital channels are re-quantised after the noise, and physically bounded channels are clamped
 * last (Stage 8 amendment). The stream is the caller's per-channel fork
 * (`createRng(seed).fork('noise:' + id)`), and every sample draws exactly one uniform and one normal
 * whatever the outcome, so the sequence is stable.
 */
import type { Rng } from '@/engine/rng';

export interface NoiseSpec {
  /** Fraction of the channel's nominal range. */
  sigmaFrac: number;
  /** Per-sample dropout probability. */
  dropoutRate: number;
  /** Nominal SI range `[lo, hi]`. */
  range: readonly [number, number];
  /** Quantisation step applied after noise, if any. */
  quantum?: number;
  /** Physical bounds applied last (after noise and quantisation), if any. */
  clamp?: readonly [number, number];
}

/** Returns a new array with noise and dropouts applied. `clean` is not modified. NaN stays NaN. */
export function applyNoise(clean: Float32Array, spec: NoiseSpec, rng: Rng): Float32Array {
  const n = clean.length;
  const out = new Float32Array(n);
  const sigma = spec.sigmaFrac * (spec.range[1] - spec.range[0]);
  const drop = spec.dropoutRate;
  const q = spec.quantum;
  const lo = spec.clamp ? spec.clamp[0] : -Infinity;
  const hi = spec.clamp ? spec.clamp[1] : Infinity;
  if (sigma === 0 && drop === 0) {
    out.set(clean);
    if (spec.clamp)
      for (let i = 0; i < n; i++)
        if (!Number.isNaN(out[i]!)) out[i] = Math.min(hi, Math.max(lo, out[i]!));
    return out;
  }
  for (let i = 0; i < n; i++) {
    const u = rng.next();
    const z = rng.normal();
    if (u < drop) {
      out[i] = NaN;
      continue;
    }
    let v = clean[i]! + sigma * z;
    if (q !== undefined && q > 0) v = Math.round(v / q) * q;
    out[i] = v < lo ? lo : v > hi ? hi : v;
  }
  return out;
}
