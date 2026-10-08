/**
 * The distractor library: real-looking sensors with no bearing on the setup levers.
 *
 * Every entry is a plausible logger channel with a believable SI range, so a 200-column Puzzle
 * CSV reads like a real car. Ranges follow stage 3's realism notes: oil temp 80–125 °C rising
 * slowly with throttle × time, battery 13.6–14.4 V with alternator ripple, fuel pressure
 * 5.8–6.2 bar, GPS altitude ±0.5 m random walk, radio RSSI −70…−40 dBm periodic fade.
 *
 * Only the `throttle_echo` / `speed_echo` entries correlate with the driving (by design: they
 * tempt the assist's correlation ranker). Everything else is generated from the seeded stream and
 * at most a slow throttle × time warm-up.
 *
 * Ids are stable forever (they appear in CSVs and saved layouts).
 */
import type { ChannelId, Quantity } from '@/engine/types';
import type { RegisteredChannel } from './def';
import type { ChannelDef, DistractorFamily } from './types';

type Group = ChannelDef['group'];
type Params = Record<string, number> & { lo: number; hi: number };

/** Deterministic per-id hash (FNV-1a), used to vary noise levels between sensors. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SIGMAS = [0.01, 0.015, 0.02, 0.025, 0.03] as const;
const DROPOUTS = [0.0005, 0.001, 0.0015, 0.002] as const;

/** Sensor noise varies per sensor (1–3% of range, ≤ 0.2% dropouts), fixed per id. */
function noiseFor(id: string): ChannelDef['noise'] {
  const h = idHash(id);
  return {
    sigmaFrac: SIGMAS[h % SIGMAS.length]!,
    dropoutRate: DROPOUTS[(h >>> 8) % DROPOUTS.length]!,
  };
}

function def(
  id: ChannelId,
  label: string,
  quantity: Quantity,
  group: Group,
  family: DistractorFamily,
  params: Params,
  noise: ChannelDef['noise'] = noiseFor(id),
): RegisteredChannel {
  let quantum: number | undefined;
  if (family === 'step_events') {
    const levels = Math.max(2, Math.round(params.levels ?? 2));
    quantum = (params.hi - params.lo) / (levels - 1);
  }
  return {
    id,
    label,
    quantity,
    group,
    source: { kind: 'distractor', family, params },
    noise,
    range: [params.lo, params.hi],
    ...(quantum !== undefined ? { quantum } : {}),
  };
}

// ---- Family shorthands (params are span fractions; see distractors.ts) ----

const drift = (lo: number, hi: number, base0: number, base1: number, rise: number, idle = -0.01) =>
  ({ lo, hi, base0, base1, rise, idle }) satisfies Params;
const flat = (
  lo: number,
  hi: number,
  base0: number,
  base1: number,
  jitter = 0.03,
  ripple = 0,
  rippleHz = 0,
) => ({ lo, hi, base0, base1, jitter, ripple, rippleHz }) satisfies Params;
const wave = (
  lo: number,
  hi: number,
  base0: number,
  base1: number,
  period0: number,
  period1: number,
  depth: number,
  jitter = 0.02,
) => ({ lo, hi, base0, base1, period0, period1, depth, jitter }) satisfies Params;
const walk = (
  lo: number,
  hi: number,
  base0: number,
  base1: number,
  sigma: number,
  revert = 0.2,
  jitter = 0.005,
) => ({ lo, hi, base0, base1, sigma, revert, jitter }) satisfies Params;
const bit = (lo: number, hi: number, ratePerMin: number, dur0: number, dur1: number, levels = 2) =>
  ({ lo, hi, rate: ratePerMin, dur0, dur1, levels, pulse: 1, base: 0 }) satisfies Params;
const counter = (lo: number, hi: number, ratePerMin: number) =>
  ({ lo, hi, rate: ratePerMin, levels: Math.round(hi - lo) + 1, pulse: 0 }) satisfies Params;
const tEcho = (
  lo: number,
  hi: number,
  base0: number,
  base1: number,
  gain: number,
  tau: number,
  jitter = 0.01,
) => ({ lo, hi, base0, base1, gain, tau, jitter }) satisfies Params;
const vEcho = (
  lo: number,
  hi: number,
  base0: number,
  base1: number,
  gain: number,
  vref: number,
  exp: number,
  tau = 0.2,
  jitter = 0.01,
) => ({ lo, hi, base0, base1, gain, vref, exp, tau, jitter }) satisfies Params;

const CORNERS = [
  ['fl', 'front left'],
  ['fr', 'front right'],
  ['rl', 'rear left'],
  ['rr', 'rear right'],
] as const;

/** One sensor per wheel corner. */
const perCorner = (
  prefix: string,
  label: string,
  quantity: Quantity,
  group: Group,
  family: DistractorFamily,
  params: Params,
): RegisteredChannel[] =>
  CORNERS.map(([c, name]) =>
    def(`${prefix}_${c}`, `${label} ${name}`, quantity, group, family, params),
  );

/** Numbered sensors `prefix_1…count` (or zero-padded `prefix_01…`). */
const numbered = (
  prefix: string,
  label: string,
  count: number,
  quantity: Quantity,
  group: Group,
  family: DistractorFamily,
  params: (i: number) => Params,
  pad = 1,
): RegisteredChannel[] =>
  Array.from({ length: count }, (_, k) => {
    const num = String(k + 1).padStart(pad, '0');
    return def(`${prefix}_${num}`, `${label} ${num}`, quantity, group, family, params(k));
  });

// ---- Powertrain ----
const POWERTRAIN: RegisteredChannel[] = [
  def(
    'oil_temp',
    'Engine oil temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(80, 125, 0.15, 0.45, 0.1, -0.02),
  ),
  def(
    'oil_pressure',
    'Engine oil pressure',
    'pressure',
    'powertrain',
    'flat_noisy',
    flat(3.5, 6.0, 0.4, 0.6, 0.03),
  ),
  def(
    'oil_level',
    'Oil tank level',
    'fraction',
    'powertrain',
    'flat_noisy',
    flat(0.55, 0.9, 0.45, 0.65, 0.04),
  ),
  def(
    'water_temp',
    'Coolant temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(75, 105, 0.2, 0.5, 0.08, -0.03),
  ),
  def(
    'water_pressure',
    'Coolant pressure',
    'pressure',
    'powertrain',
    'slow_drift',
    drift(1.0, 2.5, 0.2, 0.45, 0.06, -0.01),
  ),
  def(
    'radiator_out_temp',
    'Radiator outlet temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(60, 95, 0.2, 0.5, 0.07, -0.03),
  ),
  def(
    'gearbox_temp',
    'Gearbox oil temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(70, 120, 0.15, 0.45, 0.08, -0.01),
  ),
  def(
    'gearbox_oil_pressure',
    'Gearbox oil pressure',
    'pressure',
    'powertrain',
    'flat_noisy',
    flat(2.0, 4.0, 0.4, 0.6, 0.03),
  ),
  def(
    'diff_temp',
    'Differential oil temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(60, 110, 0.15, 0.45, 0.07, -0.01),
  ),
  def(
    'clutch_temp',
    'Clutch temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(80, 250, 0.1, 0.3, 0.05, -0.02),
  ),
  def(
    'fuel_pressure',
    'Fuel rail pressure',
    'pressure',
    'powertrain',
    'flat_noisy',
    flat(5.8, 6.2, 0.4, 0.6, 0.05),
  ),
  def(
    'fuel_temp',
    'Fuel temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(25, 45, 0.2, 0.6, 0.02, 0),
  ),
  def(
    'airbox_temp',
    'Airbox temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(25, 50, 0.2, 0.6, 0.03, 0),
  ),
  def(
    'crankcase_pressure',
    'Crankcase pressure',
    'pressure',
    'powertrain',
    'random_walk',
    walk(0.85, 1.0, 0.4, 0.6, 0.06, 0.4, 0.02),
  ),
  def(
    'hydraulic_pressure',
    'Hydraulic system pressure',
    'pressure',
    'powertrain',
    'flat_noisy',
    flat(180, 210, 0.4, 0.65, 0.02, 0.04, 3.1),
  ),
  def(
    'hydraulic_temp',
    'Hydraulic fluid temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(50, 90, 0.2, 0.5, 0.04, -0.01),
  ),
  def(
    'accumulator_pressure',
    'Hydraulic accumulator pressure',
    'pressure',
    'powertrain',
    'random_walk',
    walk(120, 160, 0.4, 0.6, 0.08, 0.3, 0.01),
  ),
  def(
    'lambda_bank_1',
    'Lambda bank 1',
    'ratio',
    'powertrain',
    'flat_noisy',
    flat(0.8, 1.0, 0.45, 0.65, 0.05),
  ),
  def(
    'lambda_bank_2',
    'Lambda bank 2',
    'ratio',
    'powertrain',
    'flat_noisy',
    flat(0.8, 1.0, 0.45, 0.65, 0.05),
  ),
  def(
    'cam_error_inlet',
    'Inlet cam position error',
    'angle',
    'powertrain',
    'random_walk',
    walk(-2, 2, 0.45, 0.55, 0.15, 1.5, 0.02),
  ),
  def(
    'cam_error_exhaust',
    'Exhaust cam position error',
    'angle',
    'powertrain',
    'random_walk',
    walk(-2, 2, 0.45, 0.55, 0.15, 1.5, 0.02),
  ),
  def(
    'intake_air_temp',
    'Intake air temperature',
    'temperature',
    'powertrain',
    'throttle_echo',
    tEcho(25, 55, 0.6, 0.75, -0.45, 0.8),
  ),
  def(
    'manifold_pressure',
    'Manifold absolute pressure',
    'pressure',
    'powertrain',
    'throttle_echo',
    tEcho(0.3, 1.05, 0, 0.05, 0.92, 0.15),
  ),
  def(
    'fuel_flow',
    'Fuel flow',
    'flow',
    'powertrain',
    'throttle_echo',
    tEcho(0, 0.03, 0.03, 0.06, 0.85, 0.2),
  ),
  ...numbered(
    'egt',
    'Exhaust gas temperature cylinder',
    6,
    'temperature',
    'powertrain',
    'throttle_echo',
    (k) => tEcho(550, 950, 0.05 + 0.01 * k, 0.15 + 0.01 * k, 0.72, 1.2 + 0.1 * k, 0.015),
  ),
];

// ---- ECU (powertrain) ----
const ECU: RegisteredChannel[] = [
  def(
    'ecu_temp',
    'ECU internal temperature',
    'temperature',
    'powertrain',
    'slow_drift',
    drift(40, 75, 0.2, 0.5, 0.03, 0.01),
  ),
  def(
    'ecu_cpu_load',
    'ECU CPU load',
    'percent',
    'powertrain',
    'flat_noisy',
    flat(0.3, 0.7, 0.35, 0.6, 0.05),
  ),
  def(
    'ecu_ref_5v',
    'ECU 5 V sensor reference',
    'voltage',
    'powertrain',
    'flat_noisy',
    flat(4.95, 5.05, 0.45, 0.55, 0.05),
  ),
  def(
    'ecu_fuel_trim_b1',
    'ECU fuel trim bank 1',
    'ratio',
    'powertrain',
    'random_walk',
    walk(-0.08, 0.08, 0.4, 0.6, 0.1, 0.5),
  ),
  def(
    'ecu_fuel_trim_b2',
    'ECU fuel trim bank 2',
    'ratio',
    'powertrain',
    'random_walk',
    walk(-0.08, 0.08, 0.4, 0.6, 0.1, 0.5),
  ),
  def(
    'ecu_ign_advance',
    'ECU ignition advance',
    'angle',
    'powertrain',
    'random_walk',
    walk(15, 35, 0.4, 0.6, 0.12, 0.8, 0.01),
  ),
  def(
    'ecu_knock_retard_b1',
    'ECU knock retard bank 1',
    'angle',
    'powertrain',
    'step_events',
    bit(0, 4, 2, 0.3, 1.5, 5),
  ),
  def(
    'ecu_knock_retard_b2',
    'ECU knock retard bank 2',
    'angle',
    'powertrain',
    'step_events',
    bit(0, 4, 2, 0.3, 1.5, 5),
  ),
  def(
    'ecu_status',
    'ECU status code',
    'angle_int',
    'powertrain',
    'step_events',
    bit(0, 3, 0.6, 0.5, 2, 4),
  ),
  def(
    'ecu_inj_duty',
    'ECU injector duty cycle',
    'percent',
    'powertrain',
    'throttle_echo',
    tEcho(0, 1, 0.04, 0.08, 0.78, 0.1),
  ),
];

// ---- Electrical ----
const PDM: Array<[string, string, number, number]> = [
  ['fuel_pump', 'fuel pump', 6, 12],
  ['ignition', 'ignition', 2, 6],
  ['injectors', 'injectors', 3, 8],
  ['ecu', 'ECU', 1, 3],
  ['dash', 'dash', 0.5, 1.5],
  ['radio', 'radio', 0.2, 2],
  ['fans', 'cooling fans', 4, 20],
  ['logger', 'data logger', 0.5, 1.5],
];

const ELECTRICAL: RegisteredChannel[] = [
  def(
    'battery_voltage',
    'Battery voltage',
    'voltage',
    'electrical',
    'flat_noisy',
    flat(13.6, 14.4, 0.45, 0.7, 0.03, 0.05, 6.7),
  ),
  def(
    'battery_temp',
    'Battery temperature',
    'temperature',
    'electrical',
    'slow_drift',
    drift(25, 45, 0.2, 0.5, 0.02, 0),
  ),
  def(
    'alternator_current',
    'Alternator current',
    'current',
    'electrical',
    'flat_noisy',
    flat(10, 45, 0.35, 0.6, 0.04, 0.05, 6.7),
  ),
  def(
    'logger_temp',
    'Data logger temperature',
    'temperature',
    'electrical',
    'slow_drift',
    drift(30, 60, 0.2, 0.5, 0.02, 0.005),
  ),
  def(
    'logger_supply_voltage',
    'Data logger supply voltage',
    'voltage',
    'electrical',
    'flat_noisy',
    flat(11.8, 12.2, 0.4, 0.6, 0.04),
  ),
  ...PDM.map(([id, name, lo, hi]) =>
    def(
      `pdm_current_${id}`,
      `PDM current ${name}`,
      'current',
      'electrical',
      'flat_noisy',
      flat(lo, hi, 0.35, 0.65, 0.04),
    ),
  ),
  def(
    'ers_soc',
    'ERS battery state of charge',
    'percent',
    'electrical',
    'random_walk',
    walk(0.4, 0.8, 0.3, 0.7, 0.02, 0.02, 0.002),
  ),
  def(
    'ers_dc_bus_voltage',
    'ERS DC bus voltage',
    'voltage',
    'electrical',
    'flat_noisy',
    flat(650, 800, 0.4, 0.7, 0.02),
  ),
  def(
    'ers_battery_temp',
    'ERS battery temperature',
    'temperature',
    'electrical',
    'slow_drift',
    drift(30, 50, 0.2, 0.5, 0.03, 0),
  ),
  def(
    'ers_inverter_temp',
    'ERS inverter temperature',
    'temperature',
    'electrical',
    'slow_drift',
    drift(40, 70, 0.2, 0.5, 0.04, -0.01),
  ),
  def(
    'ers_mguk_temp',
    'ERS MGU-K temperature',
    'temperature',
    'electrical',
    'slow_drift',
    drift(50, 110, 0.15, 0.45, 0.05, -0.01),
  ),
  ...numbered(
    'cell_temp',
    'ERS cell temperature',
    24,
    'temperature',
    'electrical',
    'slow_drift',
    () => drift(28, 48, 0.2, 0.45, 0.03, 0),
    2,
  ),
];

// ---- Chassis ----
const CHASSIS: RegisteredChannel[] = [
  ...perCorner(
    'damper_pos',
    'Damper travel',
    'percent',
    'chassis',
    'random_walk',
    walk(0, 1, 0.35, 0.5, 0.35, 3, 0.02),
  ),
  ...perCorner(
    'damper_temp',
    'Damper temperature',
    'temperature',
    'chassis',
    'slow_drift',
    drift(30, 60, 0.15, 0.45, 0.03, 0),
  ),
  ...perCorner(
    'wheel_vert_g',
    'Hub vertical acceleration',
    'accel_g',
    'chassis',
    'random_walk',
    walk(-3, 5, 0.35, 0.4, 0.4, 8, 0.03),
  ),
  def(
    'vert_g',
    'Vertical acceleration',
    'accel_g',
    'chassis',
    'random_walk',
    walk(0.6, 1.4, 0.45, 0.55, 0.3, 5, 0.02),
  ),
  def(
    'steering_torque',
    'Steering torque (N·m)',
    'dimensionless',
    'chassis',
    'random_walk',
    walk(-5, 5, 0.45, 0.55, 0.12, 0.6, 0.01),
  ),
  def(
    'strain_tierod_fl',
    'Tie rod strain front left',
    'force',
    'chassis',
    'random_walk',
    walk(-1500, 1500, 0.4, 0.6, 0.1, 0.8, 0.01),
  ),
  def(
    'strain_tierod_fr',
    'Tie rod strain front right',
    'force',
    'chassis',
    'random_walk',
    walk(-1500, 1500, 0.4, 0.6, 0.1, 0.8, 0.01),
  ),
  def(
    'strain_toelink_rl',
    'Toe link strain rear left',
    'force',
    'chassis',
    'random_walk',
    walk(-1500, 1500, 0.4, 0.6, 0.1, 0.8, 0.01),
  ),
  def(
    'strain_toelink_rr',
    'Toe link strain rear right',
    'force',
    'chassis',
    'random_walk',
    walk(-1500, 1500, 0.4, 0.6, 0.1, 0.8, 0.01),
  ),
  def(
    'strain_steering_column',
    'Steering column strain',
    'force',
    'chassis',
    'random_walk',
    walk(-400, 400, 0.4, 0.6, 0.1, 0.6, 0.01),
  ),
  def(
    'power_steering_pressure',
    'Power steering pressure',
    'pressure',
    'chassis',
    'random_walk',
    walk(30, 90, 0.3, 0.5, 0.08, 0.5, 0.01),
  ),
];

// ---- Tires ----
const TIRES: RegisteredChannel[] = [
  ...perCorner(
    'tpms_battery',
    'TPMS sensor battery',
    'voltage',
    'tires',
    'flat_noisy',
    flat(2.8, 3.1, 0.5, 0.8, 0.02),
  ),
  ...perCorner(
    'tpms_rssi',
    'TPMS signal strength',
    'dbm',
    'tires',
    'periodic',
    wave(-85, -55, 0.4, 0.6, 0.8, 2.5, 0.25, 0.04),
  ),
  ...perCorner(
    'rim_temp',
    'Rim temperature',
    'temperature',
    'tires',
    'slow_drift',
    drift(35, 75, 0.15, 0.4, 0.04, 0),
  ),
  ...perCorner(
    'hub_bearing_temp',
    'Hub bearing temperature',
    'temperature',
    'tires',
    'slow_drift',
    drift(40, 90, 0.15, 0.4, 0.04, -0.005),
  ),
];

// ---- Brakes ----
const BRAKES: RegisteredChannel[] = [
  ...perCorner(
    'caliper_temp',
    'Brake caliper temperature',
    'temperature',
    'brakes',
    'slow_drift',
    drift(80, 220, 0.1, 0.3, 0.04, -0.01),
  ),
  ...perCorner(
    'brake_pad_wear',
    'Brake pad remaining',
    'percent',
    'brakes',
    'flat_noisy',
    flat(0.6, 0.95, 0.4, 0.8, 0.02),
  ),
  def(
    'brake_fluid_temp_front',
    'Brake fluid temperature front',
    'temperature',
    'brakes',
    'slow_drift',
    drift(50, 110, 0.15, 0.45, 0.03, -0.005),
  ),
  def(
    'brake_fluid_temp_rear',
    'Brake fluid temperature rear',
    'temperature',
    'brakes',
    'slow_drift',
    drift(50, 110, 0.15, 0.45, 0.03, -0.005),
  ),
  def(
    'brake_duct_temp_front',
    'Brake duct air temperature front',
    'temperature',
    'brakes',
    'random_walk',
    walk(30, 60, 0.3, 0.5, 0.05, 0.2, 0.01),
  ),
  def(
    'brake_duct_temp_rear',
    'Brake duct air temperature rear',
    'temperature',
    'brakes',
    'random_walk',
    walk(30, 60, 0.3, 0.5, 0.05, 0.2, 0.01),
  ),
  def(
    'brake_fluid_level',
    'Brake fluid reservoir level',
    'fraction',
    'brakes',
    'flat_noisy',
    flat(0.85, 1.0, 0.4, 0.7, 0.04),
  ),
];

// ---- Aero ----
const AERO: RegisteredChannel[] = [
  ...numbered('pitot_dp', 'Pitot differential pressure', 8, 'pressure', 'aero', 'speed_echo', (k) =>
    vEcho(0, 0.06, 0, 0.04, 0.6 + 0.05 * k, 90, 2, 0.15 + 0.02 * k, 0.02),
  ),
  def(
    'cooling_air_dp',
    'Radiator duct differential pressure',
    'pressure',
    'aero',
    'speed_echo',
    vEcho(0, 0.03, 0, 0.05, 0.7, 90, 2, 0.4, 0.02),
  ),
  def(
    'strain_wing_pillar_l',
    'Rear wing pillar strain left',
    'force',
    'aero',
    'speed_echo',
    vEcho(0, 5000, 0.02, 0.06, 0.75, 90, 2, 0.1, 0.02),
  ),
  def(
    'strain_wing_pillar_r',
    'Rear wing pillar strain right',
    'force',
    'aero',
    'speed_echo',
    vEcho(0, 5000, 0.02, 0.06, 0.75, 90, 2, 0.1, 0.02),
  ),
  def(
    'strain_floor_l',
    'Floor edge strain left',
    'force',
    'aero',
    'speed_echo',
    vEcho(0, 3000, 0.05, 0.1, 0.6, 90, 2, 0.1, 0.03),
  ),
  def(
    'strain_floor_r',
    'Floor edge strain right',
    'force',
    'aero',
    'speed_echo',
    vEcho(0, 3000, 0.05, 0.1, 0.6, 90, 2, 0.1, 0.03),
  ),
  def(
    'aero_yaw_angle',
    'Aero probe yaw angle',
    'angle',
    'aero',
    'random_walk',
    walk(-4, 4, 0.45, 0.55, 0.15, 1, 0.02),
  ),
  def(
    'aero_pitch_angle',
    'Aero probe pitch angle',
    'angle',
    'aero',
    'random_walk',
    walk(-2, 2, 0.45, 0.55, 0.12, 1.2, 0.02),
  ),
  def(
    'sidepod_air_temp',
    'Sidepod exit air temperature',
    'temperature',
    'aero',
    'random_walk',
    walk(30, 60, 0.3, 0.6, 0.04, 0.1, 0.01),
  ),
  def('drs_status', 'DRS status', 'angle_int', 'aero', 'step_events', bit(0, 1, 0.8, 2, 6)),
];

// ---- Environment ----
const ENVIRONMENT: RegisteredChannel[] = [
  def(
    'ambient_pressure',
    'Ambient pressure',
    'pressure',
    'environment',
    'periodic',
    wave(1.005, 1.02, 0.3, 0.7, 40, 90, 0.12, 0.02),
  ),
  def(
    'ambient_air_temp',
    'Ambient air temperature',
    'temperature',
    'environment',
    'random_walk',
    walk(18, 30, 0.3, 0.7, 0.01, 0.05, 0.005),
  ),
  def(
    'humidity',
    'Relative humidity',
    'percent',
    'environment',
    'random_walk',
    walk(0.35, 0.75, 0.3, 0.7, 0.01, 0.05, 0.005),
  ),
  def(
    'wind_speed',
    'Wind speed',
    'speed',
    'environment',
    'random_walk',
    walk(0, 8, 0.2, 0.5, 0.12, 0.3, 0.02),
  ),
  def(
    'wind_direction',
    'Wind direction',
    'angle',
    'environment',
    'random_walk',
    walk(0, 360, 0.3, 0.7, 0.03, 0.1, 0.005),
  ),
  def(
    'track_surface_temp',
    'Track surface temperature (IR)',
    'temperature',
    'environment',
    'random_walk',
    walk(25, 50, 0.3, 0.6, 0.04, 0.5, 0.01),
  ),
  def(
    'gps_altitude',
    'GPS altitude',
    'altitude',
    'environment',
    'random_walk',
    walk(144.5, 145.5, 0.4, 0.6, 0.2, 0.2, 0.01),
  ),
  def(
    'gps_sat_count',
    'GPS satellites in view',
    'angle_int',
    'environment',
    'step_events',
    counter(8, 14, 2),
  ),
  def(
    'gps_hdop',
    'GPS horizontal dilution',
    'ratio',
    'environment',
    'random_walk',
    walk(0.6, 1.6, 0.2, 0.5, 0.05, 0.2, 0.01),
  ),
  def(
    'gps_speed',
    'GPS speed',
    'speed',
    'environment',
    'speed_echo',
    vEcho(0, 90, 0, 0, 1, 90, 1, 0.25, 0.008),
    {
      sigmaFrac: 0.01,
      dropoutRate: 0.002,
    },
  ),
];

// ---- Timing ----
const TIMING: RegisteredChannel[] = [
  def(
    'beacon_rssi',
    'Lap beacon signal strength',
    'dbm',
    'timing',
    'periodic',
    wave(-90, -50, 0.3, 0.5, 10, 30, 0.25, 0.03),
  ),
  def(
    'gps_time_offset',
    'GPS time offset',
    'time',
    'timing',
    'random_walk',
    walk(-0.005, 0.005, 0.4, 0.6, 0.05, 0.3, 0.01),
  ),
  def(
    'logger_buffer_fill',
    'Logger buffer fill',
    'percent',
    'timing',
    'periodic',
    wave(0.05, 0.4, 0.3, 0.5, 4, 12, 0.3, 0.02),
  ),
];

// ---- Misc ----
const MISC: RegisteredChannel[] = [
  def(
    'radio_rssi',
    'Team radio signal strength',
    'dbm',
    'misc',
    'periodic',
    wave(-70, -40, 0.45, 0.6, 6, 20, 0.35, 0.03),
  ),
  def('radio_ptt', 'Radio push-to-talk', 'angle_int', 'misc', 'step_events', bit(0, 1, 1, 1, 5)),
  def(
    'pit_radio_flag',
    'Pit radio message flag',
    'angle_int',
    'misc',
    'step_events',
    bit(0, 1, 0.5, 2, 8),
  ),
  def('dash_page', 'Dash page', 'angle_int', 'misc', 'step_events', counter(0, 5, 1)),
  def(
    'cockpit_temp',
    'Cockpit air temperature',
    'temperature',
    'misc',
    'slow_drift',
    drift(30, 45, 0.2, 0.5, 0.02, 0),
  ),
  def(
    'camera_temp',
    'Onboard camera temperature',
    'temperature',
    'misc',
    'slow_drift',
    drift(35, 60, 0.2, 0.5, 0.02, 0),
  ),
  def(
    'fire_ext_pressure',
    'Fire extinguisher bottle pressure',
    'pressure',
    'misc',
    'flat_noisy',
    flat(22, 26, 0.4, 0.7, 0.02),
  ),
  def(
    'logger_cpu_load',
    'Data logger CPU load',
    'percent',
    'misc',
    'flat_noisy',
    flat(0.15, 0.45, 0.3, 0.6, 0.05),
  ),
];

export const DISTRACTOR_DEFS: readonly RegisteredChannel[] = [
  ...POWERTRAIN,
  ...ECU,
  ...ELECTRICAL,
  ...CHASSIS,
  ...TIRES,
  ...BRAKES,
  ...AERO,
  ...ENVIRONMENT,
  ...TIMING,
  ...MISC,
];
