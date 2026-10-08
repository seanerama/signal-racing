/**
 * Fixture channel metadata: ids read like real sensors (contract 03 naming rules). 12-, 40- and
 * 200-channel sets. The report reads label/quantity through `channelMeta()`, which the dev route
 * and the tests point at `FIXTURE_META` via `setChannelLookup`.
 */
import type { ChannelId } from '@/engine/types';
import type { ChannelMeta } from '../channel-meta';

/** Physical-ish channels the kinematic fixture computes directly. */
export const PHYSICAL_META: Record<ChannelId, ChannelMeta> = {
  speed: { label: 'Ground speed', quantity: 'speed' },
  long_g: { label: 'Longitudinal accel', quantity: 'accel_g' },
  lat_g: { label: 'Lateral accel', quantity: 'accel_g' },
  rear_slip_ratio: { label: 'Rear slip ratio', quantity: 'ratio' },
  front_slip_ratio: { label: 'Front slip ratio', quantity: 'ratio' },
  wheel_speed_fl: { label: 'Wheel speed FL', quantity: 'speed' },
  wheel_speed_fr: { label: 'Wheel speed FR', quantity: 'speed' },
  wheel_speed_rl: { label: 'Wheel speed RL', quantity: 'speed' },
  wheel_speed_rr: { label: 'Wheel speed RR', quantity: 'speed' },
  engine_rpm: { label: 'Engine speed', quantity: 'rpm' },
  gear: { label: 'Gear', quantity: 'gear' },
  throttle: { label: 'Throttle', quantity: 'percent' },
  brake: { label: 'Brake', quantity: 'percent' },
  tire_temp_fl: { label: 'Tire temp FL', quantity: 'temperature' },
  tire_temp_fr: { label: 'Tire temp FR', quantity: 'temperature' },
  tire_temp_rl: { label: 'Tire temp RL', quantity: 'temperature' },
  tire_temp_rr: { label: 'Tire temp RR', quantity: 'temperature' },
  load_front: { label: 'Front axle load', quantity: 'force' },
  load_rear: { label: 'Rear axle load', quantity: 'force' },
  grip_used_front: { label: 'Grip used front', quantity: 'fraction' },
  grip_used_rear: { label: 'Grip used rear', quantity: 'fraction' },
  steering_angle: { label: 'Steering angle', quantity: 'angle' },
  yaw_rate: { label: 'Yaw rate', quantity: 'rate_deg_s' },
  downforce: { label: 'Downforce', quantity: 'force' },
  drag_force: { label: 'Drag force', quantity: 'force' },
  power_used: { label: 'Power used', quantity: 'power' },
  pos_x: { label: 'Position X', quantity: 'distance' },
  pos_y: { label: 'Position Y', quantity: 'distance' },
  heading: { label: 'Heading', quantity: 'angle' },
};

/** Hand-named distractors. */
export const DISTRACTOR_META: Record<ChannelId, ChannelMeta> = {
  oil_temp: { label: 'Oil temperature', quantity: 'temperature' },
  water_temp: { label: 'Water temperature', quantity: 'temperature' },
  gearbox_temp: { label: 'Gearbox temperature', quantity: 'temperature' },
  battery_voltage: { label: 'Battery voltage', quantity: 'voltage' },
  fuel_pressure: { label: 'Fuel pressure', quantity: 'pressure' },
  radio_rssi: { label: 'Radio RSSI', quantity: 'dbm' },
  ambient_pressure: { label: 'Ambient pressure', quantity: 'pressure' },
  gps_altitude: { label: 'GPS altitude', quantity: 'altitude' },
  intake_air_temp: { label: 'Intake air temperature', quantity: 'temperature' },
  hydraulic_pressure: { label: 'Hydraulic pressure', quantity: 'pressure' },
  ers_soc: { label: 'ERS state of charge', quantity: 'percent' },
  cockpit_temp: { label: 'Cockpit temperature', quantity: 'temperature' },
  steering_torque: { label: 'Steering torque', quantity: 'dimensionless' },
};

const CORNERS = ['fl', 'fr', 'rl', 'rr'];

/** Generated distractor families, to fill the 200-channel Puzzle-sized set. */
function generatedMeta(): Record<ChannelId, ChannelMeta> {
  const out: Record<ChannelId, ChannelMeta> = {};
  for (const c of CORNERS) {
    out[`damper_pos_${c}`] = { label: `Damper position ${c.toUpperCase()}`, quantity: 'distance' };
    out[`brake_disc_temp_${c}`] = {
      label: `Brake disc temp ${c.toUpperCase()}`,
      quantity: 'temperature',
    };
    out[`tire_press_${c}`] = { label: `Tire pressure ${c.toUpperCase()}`, quantity: 'pressure' };
    out[`ride_height_${c}`] = { label: `Ride height ${c.toUpperCase()}`, quantity: 'distance' };
  }
  for (let i = 1; i <= 24; i++) {
    const n = String(i).padStart(2, '0');
    out[`strain_${n}`] = { label: `Strain gauge ${n}`, quantity: 'force' };
    out[`pitot_dp_${n}`] = { label: `Pitot dP ${n}`, quantity: 'pressure' };
    out[`cell_temp_${n}`] = { label: `Battery cell temp ${n}`, quantity: 'temperature' };
    out[`can_load_${n}`] = { label: `CAN bus load ${n}`, quantity: 'percent' };
  }
  for (let i = 1; i <= 48; i++) {
    const n = String(i).padStart(2, '0');
    out[`aux_v_${n}`] = { label: `Aux voltage ${n}`, quantity: 'voltage' };
  }
  return out;
}

export const GENERATED_META = generatedMeta();

export const FIXTURE_META: Record<ChannelId, ChannelMeta> = {
  ...PHYSICAL_META,
  ...DISTRACTOR_META,
  ...GENERATED_META,
};

export type FixtureSize = 12 | 40 | 200;

const SET_12: ChannelId[] = [
  'speed',
  'long_g',
  'lat_g',
  'rear_slip_ratio',
  'wheel_speed_rl',
  'engine_rpm',
  'throttle',
  'tire_temp_rl',
  'pos_x',
  'pos_y',
  'heading',
  'oil_temp',
];

/** Fixture channel set of the given size, sorted alphabetically (registry order). */
export function fixtureChannelIds(size: FixtureSize): ChannelId[] {
  const ids = new Set<ChannelId>(SET_12);
  if (size >= 40) {
    for (const id of Object.keys(PHYSICAL_META)) ids.add(id);
    for (const id of Object.keys(DISTRACTOR_META)) {
      if (ids.size >= 40) break;
      ids.add(id);
    }
  }
  if (size >= 200) {
    for (const id of Object.keys(DISTRACTOR_META)) ids.add(id);
    for (const id of Object.keys(GENERATED_META)) {
      if (ids.size >= 200) break;
      ids.add(id);
    }
  }
  return [...ids].slice(0, size).sort();
}

export function isPhysical(id: ChannelId): boolean {
  return id in PHYSICAL_META;
}
