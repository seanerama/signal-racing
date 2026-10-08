/**
 * Input validation at the engine boundary. Throws `SimInputError` with a dotted `field` path.
 * Car parameters are not range-checked here (a malformed car is caught by the divergence guard).
 */
import { SimInputError } from './errors';
import type { LeverId, SimInput } from './types';

/** Lever ranges for the meeting cut (inclusive). `weight_dist` is checked as (0, 1) physically. */
export const LEVER_RANGES: Readonly<Record<LeverId, readonly [number, number]>> = Object.freeze({
  throttle_ramp: [0, 1.5],
  tire_pressure: [1.2, 2.2],
  weight_dist: [0.38, 0.52],
  wing: [0, 8],
});

/** Absolute slack on range ends so values built by repeated float steps (0.1·k) still pass. */
const RANGE_EPS = 1e-9;

function finite(field: string, x: unknown): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new SimInputError(field, `must be a finite number (got ${String(x)})`);
  }
  return x;
}

function inRange(field: string, x: unknown, lo: number, hi: number): void {
  const v = finite(field, x);
  if (v < lo - RANGE_EPS || v > hi + RANGE_EPS) {
    throw new SimInputError(field, `must be in [${lo}, ${hi}] (got ${v})`);
  }
}

export function validateInput(input: SimInput): void {
  const { setup, track, conditions, flags } = input;
  if (!setup) throw new SimInputError('setup', 'missing');
  const [r0, r1] = LEVER_RANGES.throttle_ramp;
  inRange('setup.throttle_ramp', setup.throttle_ramp, r0, r1);
  const [p0, p1] = LEVER_RANGES.tire_pressure;
  inRange('setup.tire_pressure', setup.tire_pressure, p0, p1);
  const d = finite('setup.weight_dist', setup.weight_dist);
  if (!(d > 0 && d < 1))
    throw new SimInputError('setup.weight_dist', `must be in (0, 1) (got ${d})`);
  const w = finite('setup.wing', setup.wing);
  const [w0, w1] = LEVER_RANGES.wing;
  if (!Number.isInteger(w) || w < w0 || w > w1) {
    throw new SimInputError('setup.wing', `must be an integer in [${w0}, ${w1}] (got ${w})`);
  }

  if (!track) throw new SimInputError('track', 'missing');
  if (!Array.isArray(track.segments) || track.segments.length < 1) {
    throw new SimInputError('track.segments', 'must contain at least one segment');
  }
  if (track.segments.length > 255) {
    throw new SimInputError('track.segments', 'at most 255 segments (seg column is Uint8)');
  }
  if (track.laps !== 1) throw new SimInputError('track.laps', 'must be 1 in the meeting cut');
  track.segments.forEach((seg, i) => {
    const f = `track.segments[${i}]`;
    const len = finite(`${f}.length`, seg.length);
    if (!(len > 0)) throw new SimInputError(`${f}.length`, `must be positive (got ${len})`);
    if (seg.kind === 'corner') {
      const r = finite(`${f}.radius`, seg.radius);
      if (!(r > 0)) throw new SimInputError(`${f}.radius`, `must be positive (got ${r})`);
      if (seg.direction !== 'left' && seg.direction !== 'right') {
        throw new SimInputError(`${f}.direction`, "must be 'left' or 'right'");
      }
      if (seg.endsWithStop) {
        throw new SimInputError(`${f}.endsWithStop`, 'only straights may end with a stop');
      }
    } else if (seg.kind !== 'straight') {
      throw new SimInputError(
        `${f}.kind`,
        `must be 'straight' or 'corner' (got ${String(seg.kind)})`,
      );
    }
  });

  if (!conditions) throw new SimInputError('conditions', 'missing');
  finite('conditions.trackTemp', conditions.trackTemp);
  finite('conditions.ambientTemp', conditions.ambientTemp);
  const gm = finite('conditions.gripMultiplier', conditions.gripMultiplier);
  if (gm < 0) throw new SimInputError('conditions.gripMultiplier', `must be ≥ 0 (got ${gm})`);

  if (!flags) throw new SimInputError('flags', 'missing');
  if (!input.car) throw new SimInputError('car', 'missing');
  const seed = finite('seed', input.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new SimInputError('seed', `must be a uint32 (got ${seed})`);
  }
}
