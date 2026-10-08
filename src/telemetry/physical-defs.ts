/**
 * Registry entries for the engine's physical channels (contract 02, "Physical channels produced").
 *
 * Stage 3 is built in parallel with the engine, so the ids and quantities are restated here from
 * contract 02, which is the source of truth. At merge, `tests/telemetry/registry.test.ts` (and the
 * reconciliation against the engine's `PHYSICAL_CHANNELS`) must agree with this list.
 *
 * Noise: every physical channel carries sensor noise and dropouts, except `pos_x`, `pos_y` and
 * `heading`, which feed the track view and must stay exact.
 *
 * Noise levels (Stage 8 amendment, "sensor-noise realism"): primary sensors (speed, wheel speeds,
 * pedals, rpm, gear, loads, accelerations) are precise, σ 0.2–0.5% of range; physics estimates
 * (μ, grip, slip ratios) keep 0.5–1%; other analogue channels keep their Stage 3 levels.
 * Physically bounded sensors carry a `clamp` (pedals 0–1, speeds ≥ 0, gear 1–6), applied after
 * the noise so a pot never reads 103% and a stationary car never reads −10 km/h.
 */
import type { ChannelId, Quantity } from '@/engine/types';
import { DEFAULT_NOISE, NO_NOISE, type RegisteredChannel } from './def';
import type { ChannelDef } from './types';

type Group = ChannelDef['group'];

interface PhysicalSpec {
  id: ChannelId;
  label: string;
  quantity: Quantity;
  group: Group;
  /** Nominal SI range. */
  range: readonly [number, number];
  sigmaFrac?: number;
  dropoutRate?: number;
  quantum?: number;
  /** Physical bounds applied after noise (SI). */
  clamp?: readonly [number, number];
}

const CORNERS = [
  ['fl', 'front left'],
  ['fr', 'front right'],
  ['rl', 'rear left'],
  ['rr', 'rear right'],
] as const;

const perCorner = (
  prefix: string,
  label: string,
  rest: Omit<PhysicalSpec, 'id' | 'label'>,
): PhysicalSpec[] =>
  CORNERS.map(([c, name]) => ({ id: `${prefix}_${c}`, label: `${label} ${name}`, ...rest }));

/** In contract-02 table order. Ranges are nominal sensor spans in SI. */
const SPECS: PhysicalSpec[] = [
  {
    id: 'speed',
    label: 'Ground speed',
    quantity: 'speed',
    group: 'chassis',
    range: [0, 90],
    sigmaFrac: 0.003,
    clamp: [0, Infinity],
  },
  {
    id: 'long_g',
    label: 'Longitudinal acceleration',
    quantity: 'accel_g',
    group: 'chassis',
    range: [-2.5, 1.5],
    sigmaFrac: 0.005,
  },
  {
    id: 'drag_force',
    label: 'Aero drag',
    quantity: 'force',
    group: 'aero',
    range: [0, 4000],
    sigmaFrac: 0.015,
  },
  {
    id: 'downforce',
    label: 'Aero downforce',
    quantity: 'force',
    group: 'aero',
    range: [0, 12000],
    sigmaFrac: 0.015,
  },
  {
    id: 'engine_force',
    label: 'Engine drive force',
    quantity: 'force',
    group: 'powertrain',
    range: [0, 10000],
    sigmaFrac: 0.01,
  },
  {
    id: 'throttle',
    label: 'Throttle position',
    quantity: 'percent',
    group: 'powertrain',
    range: [0, 1],
    sigmaFrac: 0.003,
    clamp: [0, 1],
  },
  {
    id: 'brake',
    label: 'Brake pedal',
    quantity: 'percent',
    group: 'brakes',
    range: [0, 1],
    sigmaFrac: 0.003,
    clamp: [0, 1],
  },
  {
    id: 'engine_rpm',
    label: 'Engine speed',
    quantity: 'rpm',
    group: 'powertrain',
    range: [4000, 12000],
    sigmaFrac: 0.002,
  },
  {
    id: 'gear',
    label: 'Gear',
    quantity: 'gear',
    group: 'powertrain',
    range: [1, 6],
    sigmaFrac: 0.003,
    clamp: [1, 6],
    quantum: 1,
  },
  ...perCorner('load', 'Wheel load', {
    quantity: 'force',
    group: 'chassis',
    range: [0, 6000],
    sigmaFrac: 0.005,
  }),
  {
    id: 'lat_g',
    label: 'Lateral acceleration',
    quantity: 'accel_g',
    group: 'chassis',
    range: [0, 3],
    sigmaFrac: 0.005,
  },
  {
    id: 'steering_angle',
    label: 'Steering angle',
    quantity: 'angle',
    group: 'chassis',
    range: [0, 5],
    sigmaFrac: 0.02,
  },
  {
    id: 'heading',
    label: 'Heading',
    quantity: 'angle',
    group: 'chassis',
    range: [-180, 180],
    sigmaFrac: 0,
    dropoutRate: 0,
  },
  {
    id: 'grip_budget_front',
    label: 'Grip budget front axle',
    quantity: 'force',
    group: 'tires',
    range: [0, 15000],
    sigmaFrac: 0.01,
  },
  {
    id: 'grip_budget_rear',
    label: 'Grip budget rear axle',
    quantity: 'force',
    group: 'tires',
    range: [0, 15000],
    sigmaFrac: 0.01,
  },
  {
    id: 'grip_used_front',
    label: 'Grip used front axle',
    quantity: 'fraction',
    group: 'tires',
    range: [0, 1],
    sigmaFrac: 0.01,
  },
  {
    id: 'grip_used_rear',
    label: 'Grip used rear axle',
    quantity: 'fraction',
    group: 'tires',
    range: [0, 1],
    sigmaFrac: 0.01,
  },
  // Stage 9: the axle forces behind grip_used (model estimates; the grip circle plots them).
  {
    id: 'fx_front',
    label: 'Tire force longitudinal front axle',
    quantity: 'force',
    group: 'tires',
    range: [-15000, 15000],
    sigmaFrac: 0.005,
  },
  {
    id: 'fy_front',
    label: 'Tire force lateral front axle',
    quantity: 'force',
    group: 'tires',
    range: [-15000, 15000],
    sigmaFrac: 0.005,
  },
  {
    id: 'fx_rear',
    label: 'Tire force longitudinal rear axle',
    quantity: 'force',
    group: 'tires',
    range: [-15000, 15000],
    sigmaFrac: 0.005,
  },
  {
    id: 'fy_rear',
    label: 'Tire force lateral rear axle',
    quantity: 'force',
    group: 'tires',
    range: [-15000, 15000],
    sigmaFrac: 0.005,
  },
  {
    id: 'front_slip_ratio',
    label: 'Front slip ratio',
    quantity: 'ratio',
    group: 'tires',
    range: [0, 0.5],
    sigmaFrac: 0.01,
  },
  {
    id: 'rear_slip_ratio',
    label: 'Rear slip ratio',
    quantity: 'ratio',
    group: 'tires',
    range: [0, 0.5],
    sigmaFrac: 0.01,
  },
  ...perCorner('wheel_speed', 'Wheel speed', {
    quantity: 'speed',
    group: 'tires',
    range: [0, 90],
    sigmaFrac: 0.003,
    clamp: [0, Infinity],
  }),
  ...perCorner('tire_temp', 'Tire temperature', {
    quantity: 'temperature',
    group: 'tires',
    range: [20, 140],
    sigmaFrac: 0.01,
  }),
  {
    id: 'brake_temp_front',
    label: 'Brake disc temperature front',
    quantity: 'temperature',
    group: 'brakes',
    range: [20, 900],
    sigmaFrac: 0.01,
  },
  {
    id: 'brake_temp_rear',
    label: 'Brake disc temperature rear',
    quantity: 'temperature',
    group: 'brakes',
    range: [20, 900],
    sigmaFrac: 0.01,
  },
  {
    id: 'mu_front',
    label: 'Tire friction coefficient front',
    quantity: 'dimensionless',
    group: 'tires',
    range: [0, 2],
    sigmaFrac: 0.01,
  },
  {
    id: 'mu_rear',
    label: 'Tire friction coefficient rear',
    quantity: 'dimensionless',
    group: 'tires',
    range: [0, 2],
    sigmaFrac: 0.01,
  },
  {
    id: 'rolling_force',
    label: 'Rolling resistance',
    quantity: 'force',
    group: 'chassis',
    range: [0, 300],
    sigmaFrac: 0.02,
  },
  {
    id: 'power_used',
    label: 'Engine power used',
    quantity: 'power',
    group: 'powertrain',
    range: [0, 500_000],
    sigmaFrac: 0.01,
  },
  {
    id: 'load_front',
    label: 'Axle load front',
    quantity: 'force',
    group: 'chassis',
    range: [0, 12000],
    sigmaFrac: 0.005,
  },
  {
    id: 'load_rear',
    label: 'Axle load rear',
    quantity: 'force',
    group: 'chassis',
    range: [0, 12000],
    sigmaFrac: 0.005,
  },
  {
    id: 'yaw_rate',
    label: 'Yaw rate',
    quantity: 'rate_deg_s',
    group: 'chassis',
    range: [0, 60],
    sigmaFrac: 0.015,
  },
  {
    id: 'pos_x',
    label: 'Position east',
    quantity: 'distance',
    group: 'chassis',
    range: [-2000, 2000],
    sigmaFrac: 0,
    dropoutRate: 0,
  },
  {
    id: 'pos_y',
    label: 'Position north',
    quantity: 'distance',
    group: 'chassis',
    range: [-2000, 2000],
    sigmaFrac: 0,
    dropoutRate: 0,
  },
  {
    id: 'corner_limit_speed',
    label: 'Corner limit speed',
    quantity: 'speed',
    group: 'chassis',
    range: [0, 90],
    sigmaFrac: 0.01,
  },
  // Stage 11: the run's real conditions (an IR track sensor and the grip estimate). They replace
  // the random-walk `track_surface_temp` distractor, which looked like these and explained nothing.
  {
    id: 'track_temp',
    label: 'Track surface temperature',
    quantity: 'temperature',
    group: 'environment',
    range: [0, 60],
    sigmaFrac: 0.004,
  },
  {
    id: 'grip_multiplier',
    label: 'Track grip multiplier',
    quantity: 'dimensionless',
    group: 'environment',
    range: [0.8, 1.1],
    sigmaFrac: 0.005,
  },
];

/** Contract-02 physical channel ids with their quantities (mirror of the engine's `PHYSICAL_CHANNELS`). */
export const PHYSICAL_CHANNEL_SPECS: readonly { id: ChannelId; quantity: Quantity }[] = SPECS.map(
  ({ id, quantity }) => ({ id, quantity }),
);

/** Contract-02 physical channel ids. */
export const PHYSICAL_CHANNEL_IDS: readonly ChannelId[] = SPECS.map((s) => s.id);

/** Channels that must never be noisy (they drive the track view). */
export const EXACT_CHANNEL_IDS: readonly ChannelId[] = ['pos_x', 'pos_y', 'heading'];

export const PHYSICAL_DEFS: readonly RegisteredChannel[] = SPECS.map((s) => {
  const exact = EXACT_CHANNEL_IDS.includes(s.id);
  const def: RegisteredChannel = {
    id: s.id,
    label: s.label,
    quantity: s.quantity,
    group: s.group,
    source: { kind: 'physical' },
    noise: exact
      ? NO_NOISE
      : {
          sigmaFrac: s.sigmaFrac ?? DEFAULT_NOISE.sigmaFrac,
          dropoutRate: s.dropoutRate ?? DEFAULT_NOISE.dropoutRate,
        },
    range: s.range,
    ...(s.quantum !== undefined ? { quantum: s.quantum } : {}),
    ...(s.clamp ? { clamp: s.clamp } : {}),
  };
  return def;
});
