/** Validation: each invalid field throws SimInputError with the right `field`. */
import { describe, expect, it } from 'vitest';
import { SimInputError, simulate, validateInput } from '@/engine/index';
import type { SimInput } from '@/engine/types';
import { FLAGS_A2, TRACK_A4, input } from './fixtures';

function fieldOf(fn: () => void): string | null {
  try {
    fn();
  } catch (e) {
    if (e instanceof SimInputError) return e.field;
    throw e;
  }
  return null;
}

type Mutator = (x: SimInput) => void;
const cases: [string, Mutator][] = [
  ['setup.throttle_ramp', (x) => (x.setup.throttle_ramp = -0.1)],
  ['setup.throttle_ramp', (x) => (x.setup.throttle_ramp = 1.6)],
  ['setup.throttle_ramp', (x) => (x.setup.throttle_ramp = NaN)],
  ['setup.tire_pressure', (x) => (x.setup.tire_pressure = 1.1)],
  ['setup.tire_pressure', (x) => (x.setup.tire_pressure = 2.3)],
  ['setup.weight_dist', (x) => (x.setup.weight_dist = 0)],
  ['setup.weight_dist', (x) => (x.setup.weight_dist = 1)],
  ['setup.weight_dist', (x) => (x.setup.weight_dist = Infinity)],
  ['setup.wing', (x) => (x.setup.wing = 3.5)],
  ['setup.wing', (x) => (x.setup.wing = 9)],
  ['setup.wing', (x) => (x.setup.wing = -1)],
  ['track.segments', (x) => (x.track.segments = [])],
  ['track.segments[0].length', (x) => (x.track.segments[0]!.length = 0)],
  ['track.segments[1].length', (x) => (x.track.segments[1]!.length = -3)],
  ['track.segments[1].radius', (x) => (x.track.segments[1]!.radius = 0)],
  ['track.segments[1].radius', (x) => delete x.track.segments[1]!.radius],
  ['track.segments[1].direction', (x) => delete x.track.segments[1]!.direction],
  ['track.segments[1].endsWithStop', (x) => (x.track.segments[1]!.endsWithStop = true)],
  ['track.segments[0].kind', (x) => ((x.track.segments[0] as { kind: string }).kind = 'hairpin')],
  ['track.laps', (x) => ((x.track as { laps: number }).laps = 2)],
  ['conditions.trackTemp', (x) => (x.conditions.trackTemp = NaN)],
  ['conditions.ambientTemp', (x) => (x.conditions.ambientTemp = Infinity)],
  ['conditions.gripMultiplier', (x) => (x.conditions.gripMultiplier = -0.1)],
  ['seed', (x) => (x.seed = 1.5)],
  ['seed', (x) => (x.seed = -1)],
];

function fresh(): SimInput {
  const x = input(TRACK_A4, FLAGS_A2);
  return structuredClone({ ...x, car: { ...x.car } });
}

describe('validateInput', () => {
  it('accepts every lever-range corner of a valid input', () => {
    for (const s of [
      { throttle_ramp: 0, tire_pressure: 1.2, weight_dist: 0.38, wing: 0 },
      { throttle_ramp: 1.5, tire_pressure: 2.2, weight_dist: 0.52, wing: 8 },
      { throttle_ramp: 3 * 0.1 * 5, tire_pressure: 1.2 + 10 * 0.1, weight_dist: 0.99, wing: 4 },
    ]) {
      const x = fresh();
      x.setup = s;
      expect(() => validateInput(x)).not.toThrow();
    }
  });

  it.each(cases)('rejects %s', (field, mutate) => {
    const x = fresh();
    mutate(x);
    expect(fieldOf(() => validateInput(x))).toBe(field);
    // simulate validates at its boundary too.
    expect(fieldOf(() => simulate(x, 'fast'))).toBe(field);
  });

  it('rejects missing parts', () => {
    for (const key of ['setup', 'track', 'conditions', 'flags', 'car'] as const) {
      const x = fresh() as unknown as Record<string, unknown>;
      delete x[key];
      expect(fieldOf(() => validateInput(x as unknown as SimInput))).toBe(key);
    }
  });

  it('rejects more than 255 segments (the seg column is Uint8)', () => {
    const x = fresh();
    x.track.segments = Array.from({ length: 256 }, (_, i) => ({
      id: `s${i}`,
      label: '',
      kind: 'straight' as const,
      length: 1,
    }));
    expect(fieldOf(() => validateInput(x))).toBe('track.segments');
  });

  it('SimInputError carries a name and message', () => {
    const e = new SimInputError('setup.wing', 'bad');
    expect(e.name).toBe('SimInputError');
    expect(e.message).toContain('setup.wing');
    expect(e).toBeInstanceOf(Error);
  });
});
