/**
 * Distractor generator families (contract 03, `DistractorFamily`).
 *
 * Every generator has the shape `(n, dt, t, s, throttle, speed, rng, params) → Float32Array` and
 * reads nothing else: never a setup lever, never a physics channel beyond throttle and speed. So the
 * non-echo families are honestly irrelevant to the setup. Their run-to-run variation comes from the
 * seeded stream (per-run baseline, phase, events), which dwarfs the small time-integration effect of
 * a longer or shorter run. The two `*_echo` families correlate with throttle or speed on purpose:
 * they are what tempts a naive correlation ranker.
 *
 * All params are fractions of the sensor span unless noted, and the output is SI:
 * `value = lo + (hi − lo) × x`. Every family takes `lo` and `hi`.
 *
 * The clean output already includes the sensor's own physical behaviour (ripple, wander, events).
 * The noise layer (`noise.ts`) adds measurement noise and dropouts on top.
 */
import type { Rng } from '@/engine/rng';
import type { DistractorFamily } from './types';

export type DistractorParams = Record<string, number>;

export type DistractorGenerator = (
  n: number,
  dt: number,
  t: Float32Array,
  s: Float32Array,
  throttle: Float32Array,
  speed: Float32Array,
  rng: Rng,
  params: DistractorParams,
) => Float32Array;

function p(params: DistractorParams, key: string, fallback?: number): number {
  const v = params[key];
  if (v !== undefined) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`distractor param '${key}' is required`);
}

/** Uniform draw in [a, b). */
const uniform = (rng: Rng, a: number, b: number): number => a + (b - a) * rng.next();

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Writes `lo + span × x` into `out[i]` (x clamped to [0, 1]: a sensor saturates at its range). */
function emit(out: Float32Array, i: number, lo: number, span: number, x: number): void {
  out[i] = lo + span * clamp01(x);
}

/**
 * Per-run baseline in [base0, base1]: the run-to-run spread every real sensor shows
 * (warm-up state, calibration, weather).
 */
function baseline(rng: Rng, params: DistractorParams): number {
  return uniform(rng, p(params, 'base0'), p(params, 'base1'));
}

/**
 * `slow_drift`: fluid and component temperatures. Starts at a per-run level and warms slowly with
 * throttle × time (`rise` = span fraction per 100 s at full throttle; `idle` = per 100 s at zero
 * throttle, negative to cool), plus a slow wander (`wander`, span fraction).
 */
export const slowDrift: DistractorGenerator = (n, dt, _t, _s, throttle, _speed, rng, params) => {
  const lo = p(params, 'lo');
  const span = p(params, 'hi') - lo;
  const rise = p(params, 'rise');
  const idle = p(params, 'idle', 0);
  const wander = p(params, 'wander', 0.004);
  const out = new Float32Array(n);
  let x = baseline(rng, params);
  let w = 0;
  const revert = 0.05; // 1/s, wander mean reversion
  for (let i = 0; i < n; i++) {
    const th = throttle[i] ?? 0;
    x += ((th * rise + (1 - th) * idle) * dt) / 100;
    w += -revert * w * dt + wander * Math.sqrt(dt) * rng.normal();
    emit(out, i, lo, span, x + w);
  }
  return out;
};

/**
 * `flat_noisy`: regulated quantities (supply voltages, fuel pressure). A per-run level, white
 * jitter (`jitter`) and an optional ripple (`ripple` amplitude at `rippleHz`).
 */
export const flatNoisy: DistractorGenerator = (n, _dt, t, _s, _throttle, _speed, rng, params) => {
  const lo = p(params, 'lo');
  const span = p(params, 'hi') - lo;
  const jitter = p(params, 'jitter', 0.02);
  const ripple = p(params, 'ripple', 0);
  const hz = p(params, 'rippleHz', 0);
  const out = new Float32Array(n);
  const c = baseline(rng, params);
  const phase = uniform(rng, 0, 2 * Math.PI);
  for (let i = 0; i < n; i++) {
    const r = ripple > 0 ? ripple * Math.sin(2 * Math.PI * hz * t[i]! + phase) : 0;
    emit(out, i, lo, span, c + r + jitter * rng.normal());
  }
  return out;
};

/**
 * `periodic`: radio fades, slow ambient wobble. A per-run level, a fundamental with a period drawn
 * from [period0, period1] s, a weaker second harmonic, depth `depth`, and jitter.
 */
export const periodic: DistractorGenerator = (n, _dt, t, _s, _throttle, _speed, rng, params) => {
  const lo = p(params, 'lo');
  const span = p(params, 'hi') - lo;
  const depth = p(params, 'depth');
  const jitter = p(params, 'jitter', 0.01);
  const out = new Float32Array(n);
  const c = baseline(rng, params);
  const period = uniform(rng, p(params, 'period0'), p(params, 'period1'));
  const ph1 = uniform(rng, 0, 2 * Math.PI);
  const ph2 = uniform(rng, 0, 2 * Math.PI);
  const w = (2 * Math.PI) / period;
  for (let i = 0; i < n; i++) {
    const ti = t[i]!;
    const wave = (Math.sin(w * ti + ph1) + 0.35 * Math.sin(2 * w * ti + ph2)) / 1.35;
    emit(out, i, lo, span, c + depth * wave + jitter * rng.normal());
  }
  return out;
};

/**
 * `random_walk`: GPS altitude jitter, probe angles, strain on lightly loaded members. A
 * mean-reverting walk (Ornstein–Uhlenbeck) around a per-run level: `sigma` = span fraction per √s,
 * `revert` 1/s, plus white `jitter`.
 */
export const randomWalk: DistractorGenerator = (n, dt, _t, _s, _throttle, _speed, rng, params) => {
  const lo = p(params, 'lo');
  const span = p(params, 'hi') - lo;
  const sigma = p(params, 'sigma');
  const revert = p(params, 'revert', 0.2);
  const jitter = p(params, 'jitter', 0.005);
  const out = new Float32Array(n);
  const c = baseline(rng, params);
  // Start inside the stationary distribution so the first second does not look like a settle.
  const stationary = sigma / Math.sqrt(2 * revert);
  let x = c + stationary * rng.normal();
  const sqdt = Math.sqrt(dt);
  for (let i = 0; i < n; i++) {
    x += -revert * (x - c) * dt + sigma * sqdt * rng.normal();
    emit(out, i, lo, span, x + jitter * rng.normal());
  }
  return out;
};

/**
 * `step_events`: status bits and discrete counters. Holds a level and switches at Poisson times
 * (`rate` events per minute). `levels` discrete values evenly spaced over the span (2 = a bit).
 * With `pulse` = 1 each event is a pulse of [dur0, dur1] s back to the base level `base`
 * (a level index); otherwise each event moves the held level by ±1 (a counter that wanders).
 */
export const stepEvents: DistractorGenerator = (n, dt, _t, _s, _throttle, _speed, rng, params) => {
  const lo = p(params, 'lo');
  const span = p(params, 'hi') - lo;
  const levels = Math.max(2, Math.round(p(params, 'levels', 2)));
  const rate = p(params, 'rate') / 60;
  const pulse = p(params, 'pulse', 1) >= 0.5;
  const base = Math.round(p(params, 'base', 0));
  const dur0 = p(params, 'dur0', 0.5);
  const dur1 = p(params, 'dur1', 3);
  const out = new Float32Array(n);
  const step = 1 / (levels - 1);
  const pEvent = 1 - Math.exp(-rate * dt);
  let level = pulse ? base : Math.floor(uniform(rng, 0, levels));
  let pulseLeft = 0;
  for (let i = 0; i < n; i++) {
    const u = rng.next();
    if (pulse) {
      if (pulseLeft > 0) {
        pulseLeft -= dt;
        if (pulseLeft <= 0) level = base;
      } else if (u < pEvent) {
        pulseLeft = uniform(rng, dur0, dur1);
        // Any level other than the base.
        const k = 1 + Math.floor(rng.next() * (levels - 1));
        level = (base + k) % levels;
      }
    } else if (u < pEvent) {
      const dir = rng.next() < 0.5 ? -1 : 1;
      level = Math.min(levels - 1, Math.max(0, level + dir));
    }
    out[i] = lo + span * level * step;
  }
  return out;
};

/**
 * `throttle_echo`: follows a lagged throttle (time constant `tau` s) with gain `gain` (may be
 * negative) around a per-run level, plus jitter. Explains nothing, correlates with throttle.
 */
export const throttleEcho: DistractorGenerator = (n, dt, _t, _s, throttle, _speed, rng, params) => {
  const lo = p(params, 'lo');
  const span = p(params, 'hi') - lo;
  const gain = p(params, 'gain');
  const tau = p(params, 'tau', 0.5);
  const jitter = p(params, 'jitter', 0.01);
  const out = new Float32Array(n);
  const c = baseline(rng, params);
  const a = Math.min(1, dt / tau);
  let lp = throttle[0] ?? 0;
  for (let i = 0; i < n; i++) {
    lp += ((throttle[i] ?? 0) - lp) * a;
    emit(out, i, lo, span, c + gain * lp + jitter * rng.normal());
  }
  return out;
};

/**
 * `speed_echo`: follows a lagged speed through `(v / vref)^exp` (dynamic pressure is `exp` = 2)
 * with gain `gain` around a per-run level, plus jitter. `vref` in m/s.
 */
export const speedEcho: DistractorGenerator = (n, dt, _t, _s, _throttle, speed, rng, params) => {
  const lo = p(params, 'lo');
  const span = p(params, 'hi') - lo;
  const gain = p(params, 'gain');
  const vref = p(params, 'vref');
  const exp = p(params, 'exp', 1);
  const tau = p(params, 'tau', 0.2);
  const jitter = p(params, 'jitter', 0.01);
  const out = new Float32Array(n);
  const c = baseline(rng, params);
  const a = Math.min(1, dt / tau);
  let lp = speed[0] ?? 0;
  for (let i = 0; i < n; i++) {
    lp += ((speed[i] ?? 0) - lp) * a;
    const r = Math.max(0, lp) / vref;
    emit(out, i, lo, span, c + gain * Math.pow(r, exp) + jitter * rng.normal());
  }
  return out;
};

export const DISTRACTOR_FAMILIES: Readonly<Record<DistractorFamily, DistractorGenerator>> = {
  slow_drift: slowDrift,
  flat_noisy: flatNoisy,
  periodic,
  random_walk: randomWalk,
  step_events: stepEvents,
  throttle_echo: throttleEcho,
  speed_echo: speedEcho,
};

/** Families that correlate with throttle or speed by design. */
export const ECHO_FAMILIES: readonly DistractorFamily[] = ['throttle_echo', 'speed_echo'];

/** Runs a family's generator. */
export function generateDistractor(
  family: DistractorFamily,
  args: {
    n: number;
    dt: number;
    t: Float32Array;
    s: Float32Array;
    throttle: Float32Array;
    speed: Float32Array;
    rng: Rng;
    params: DistractorParams;
  },
): Float32Array {
  const gen = DISTRACTOR_FAMILIES[family];
  return gen(args.n, args.dt, args.t, args.s, args.throttle, args.speed, args.rng, args.params);
}
