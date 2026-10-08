import { describe, expect, it } from 'vitest';
import {
  QUANTITIES,
  UNIT_SYSTEMS,
  formatValue,
  fromDisplay,
  precision,
  toDisplay,
  unitLabel,
  type Quantity,
  type UnitSystem,
} from '@/units';

const SAMPLES = [-273.15, -12.5, -1, 0, 1e-6, 0.4, 1, 1.65, 27.7777, 90, 1000, 500_000];

describe('units: round trip', () => {
  for (const q of QUANTITIES) {
    for (const sys of UNIT_SYSTEMS) {
      it(`${q} / ${sys}: fromDisplay(toDisplay(x)) ≈ x`, () => {
        for (const x of SAMPLES) {
          const back = fromDisplay(q, sys, toDisplay(q, sys, x));
          expect(back).toBeCloseTo(x, 9);
        }
      });
    }
  }

  it('covers all 23 contract quantities', () => {
    expect(new Set(QUANTITIES).size).toBe(23);
  });
});

describe('units: spot values', () => {
  it('100 km/h ↔ 62.1 mph', () => {
    const si = fromDisplay('speed', 'metric', 100);
    expect(si).toBeCloseTo(27.7778, 4);
    expect(toDisplay('speed', 'imperial', si)).toBeCloseTo(62.137, 3);
    expect(formatValue('speed', 'imperial', si)).toBe('62.1 mph');
    expect(formatValue('speed', 'metric', si)).toBe('100.0 km/h');
  });

  it('90 °C ↔ 194 °F', () => {
    expect(toDisplay('temperature', 'imperial', 90)).toBeCloseTo(194, 9);
    expect(fromDisplay('temperature', 'imperial', 194)).toBeCloseTo(90, 9);
    expect(formatValue('temperature', 'imperial', 90)).toBe('194.0 °F');
  });

  it('1.65 bar ↔ 23.9 psi', () => {
    expect(toDisplay('pressure', 'imperial', 1.65)).toBeCloseTo(23.93, 2);
    expect(formatValue('pressure', 'imperial', 1.65)).toBe('23.9 psi');
    expect(formatValue('pressure', 'metric', 1.65)).toBe('1.65 bar');
  });

  it('force shows kN / lbf; accel_g is system-invariant', () => {
    expect(formatValue('force', 'metric', 10_000)).toBe('10.00 kN');
    expect(formatValue('force', 'imperial', 10_000)).toBe('2248 lbf');
    expect(toDisplay('accel_g', 'imperial', 1.2)).toBe(1.2);
    expect(unitLabel('accel_g', 'metric')).toBe('g');
    expect(unitLabel('accel_g', 'imperial')).toBe('g');
  });

  it('percent is stored 0–1', () => {
    expect(formatValue('percent', 'metric', 0.5)).toBe('50.0 %');
  });
});

describe('units: labels and precision (design-system.md)', () => {
  const table: Array<[Quantity, UnitSystem, string, number]> = [
    ['time', 'metric', 's', 3],
    ['time', 'imperial', 's', 3],
    ['speed', 'metric', 'km/h', 1],
    ['speed', 'imperial', 'mph', 1],
    ['accel_g', 'metric', 'g', 2],
    ['ratio', 'metric', '', 3],
    ['temperature', 'metric', '°C', 1],
    ['temperature', 'imperial', '°F', 1],
    ['pressure', 'metric', 'bar', 2],
    ['pressure', 'imperial', 'psi', 1],
    ['force', 'metric', 'kN', 2],
    ['force', 'imperial', 'lbf', 0],
    ['mass', 'imperial', 'lb', 1],
    ['distance', 'imperial', 'ft', 1],
  ];
  for (const [q, sys, label, dp] of table) {
    it(`${q} / ${sys} → "${label}", ${dp} dp`, () => {
      expect(unitLabel(q, sys)).toBe(label);
      expect(precision(q, sys)).toBe(dp);
    });
  }
});

describe('units: formatValue edge cases', () => {
  it('omits the unit on request and for unitless quantities', () => {
    expect(formatValue('speed', 'metric', 10, { withUnit: false })).toBe('36.0');
    expect(formatValue('ratio', 'metric', 0.1819)).toBe('0.182');
    expect(formatValue('angle_int', 'metric', 4)).toBe('4');
  });

  it('renders NaN dropouts, infinities and negative zero', () => {
    expect(formatValue('speed', 'metric', Number.NaN)).toBe('—');
    expect(formatValue('time', 'metric', Number.POSITIVE_INFINITY)).toBe('∞ s');
    expect(formatValue('time', 'metric', -0.0001)).toBe('0.000 s');
    expect(formatValue('accel_g', 'metric', -0.5)).toBe('-0.50 g');
  });
});
