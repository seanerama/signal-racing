/**
 * Units layer (contract 01). SI internally everywhere; this module converts at the display edge.
 * Pure: no DOM, no UI imports. Precision per design-system.md "Units presentation".
 *
 * Conversion is affine: `display = si × factor + offset`.
 */
import type { Quantity } from '@/engine/types';

export type { Quantity } from '@/engine/types';

export type UnitSystem = 'metric' | 'imperial';

/** Every quantity, in a stable order (useful for tests and pickers). */
export const QUANTITIES: readonly Quantity[] = [
  'time',
  'distance',
  'speed',
  'accel_g',
  'force',
  'mass',
  'temperature',
  'pressure',
  'ratio',
  'fraction',
  'angle',
  'angle_int',
  'rpm',
  'gear',
  'voltage',
  'current',
  'power',
  'rate_deg_s',
  'percent',
  'dbm',
  'altitude',
  'flow',
  'dimensionless',
];

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'];

interface UnitSpec {
  /** Display label; '' for unitless quantities (the UI shows its own placeholder). */
  label: string;
  factor: number;
  offset: number;
  /** Decimal places. */
  dp: number;
}

const unit = (label: string, factor: number, dp: number, offset = 0): UnitSpec => ({
  label,
  factor,
  offset,
  dp,
});

/** m → ft. */
const M_TO_FT = 1 / 0.3048;
/** m/s → mph. */
const MS_TO_MPH = 3600 / 1609.344;
/** N → lbf. */
const N_TO_LBF = 1 / 4.4482216152605;
/** kg → lb. */
const KG_TO_LB = 1 / 0.45359237;
/** bar → psi. */
const BAR_TO_PSI = 14.503773773;
/** W → mechanical hp. */
const W_TO_HP = 1 / 745.69987158227;

/** SI base (storage unit) of each quantity, then metric and imperial display units. */
const TABLE: Record<Quantity, Record<UnitSystem, UnitSpec>> = {
  /** SI s. */
  time: { metric: unit('s', 1, 3), imperial: unit('s', 1, 3) },
  /** SI m. */
  distance: { metric: unit('m', 1, 1), imperial: unit('ft', M_TO_FT, 1) },
  /** SI m/s, shown as km/h or mph. */
  speed: { metric: unit('km/h', 3.6, 1), imperial: unit('mph', MS_TO_MPH, 1) },
  /** Stored in g; system-invariant. */
  accel_g: { metric: unit('g', 1, 2), imperial: unit('g', 1, 2) },
  /** SI N, shown as kN or lbf. */
  force: { metric: unit('kN', 0.001, 2), imperial: unit('lbf', N_TO_LBF, 0) },
  /** SI kg. */
  mass: { metric: unit('kg', 1, 1), imperial: unit('lb', KG_TO_LB, 1) },
  /** Stored °C. */
  temperature: { metric: unit('°C', 1, 1), imperial: unit('°F', 1.8, 1, 32) },
  /** Stored bar. */
  pressure: { metric: unit('bar', 1, 2), imperial: unit('psi', BAR_TO_PSI, 1) },
  /** Unitless (e.g. slip ratio). */
  ratio: { metric: unit('', 1, 3), imperial: unit('', 1, 3) },
  /** Unitless 0–1 (e.g. grip used, weight distribution). */
  fraction: { metric: unit('', 1, 2), imperial: unit('', 1, 2) },
  /** Stored deg. */
  angle: { metric: unit('°', 1, 1), imperial: unit('°', 1, 1) },
  /** Integer setting with no unit (e.g. wing position 0..8). */
  angle_int: { metric: unit('', 1, 0), imperial: unit('', 1, 0) },
  /** 1/min. */
  rpm: { metric: unit('rpm', 1, 0), imperial: unit('rpm', 1, 0) },
  /** Integer gear. */
  gear: { metric: unit('', 1, 0), imperial: unit('', 1, 0) },
  /** V. */
  voltage: { metric: unit('V', 1, 2), imperial: unit('V', 1, 2) },
  /** A. */
  current: { metric: unit('A', 1, 1), imperial: unit('A', 1, 1) },
  /** SI W, shown as kW or hp. */
  power: { metric: unit('kW', 0.001, 1), imperial: unit('hp', W_TO_HP, 1) },
  /** deg/s. */
  rate_deg_s: { metric: unit('°/s', 1, 1), imperial: unit('°/s', 1, 1) },
  /** Stored 0–1, shown as %. */
  percent: { metric: unit('%', 100, 1), imperial: unit('%', 100, 1) },
  /** dBm. */
  dbm: { metric: unit('dBm', 1, 1), imperial: unit('dBm', 1, 1) },
  /** SI m. */
  altitude: { metric: unit('m', 1, 1), imperial: unit('ft', M_TO_FT, 0) },
  /** SI kg/s, shown as kg/h or lb/h. */
  flow: { metric: unit('kg/h', 3600, 1), imperial: unit('lb/h', 3600 * KG_TO_LB, 1) },
  /** Unitless (e.g. μ). */
  dimensionless: { metric: unit('', 1, 3), imperial: unit('', 1, 3) },
};

function spec(q: Quantity, sys: UnitSystem): UnitSpec {
  return TABLE[q][sys];
}

/** Display unit label, e.g. `'km/h'` or `'mph'`. Empty string for unitless quantities. */
export function unitLabel(q: Quantity, sys: UnitSystem): string {
  return spec(q, sys).label;
}

/** SI (storage) value → display value. */
export function toDisplay(q: Quantity, sys: UnitSystem, si: number): number {
  const u = spec(q, sys);
  return si * u.factor + u.offset;
}

/** Display value → SI (storage) value. Inverse of `toDisplay`. */
export function fromDisplay(q: Quantity, sys: UnitSystem, v: number): number {
  const u = spec(q, sys);
  return (v - u.offset) / u.factor;
}

/** Decimal places used when formatting this quantity in this system. */
export function precision(q: Quantity, sys: UnitSystem): number {
  return spec(q, sys).dp;
}

/**
 * Formats an SI value for display: converted, fixed to `precision()`, with the unit appended
 * (`withUnit` defaults to true; unitless quantities never get a suffix).
 * NaN (a dropout) renders as `'—'`; ±Infinity as `'∞'` / `'−∞'`. Negative zero renders as zero.
 */
export function formatValue(
  q: Quantity,
  sys: UnitSystem,
  si: number,
  opts?: { withUnit?: boolean },
): string {
  const u = spec(q, sys);
  const withUnit = opts?.withUnit ?? true;
  let body: string;
  if (Number.isNaN(si)) {
    return '—';
  } else if (!Number.isFinite(si)) {
    body = si > 0 ? '∞' : '−∞';
  } else {
    body = (si * u.factor + u.offset).toFixed(u.dp);
    if (/^-0\.?0*$/.test(body)) body = body.slice(1);
  }
  return withUnit && u.label ? `${body} ${u.label}` : body;
}
