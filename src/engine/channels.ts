/** Physical channel metadata (contract 02 "Physical channels produced"). All values are SI. */
import type { ChannelId, Quantity } from './types';

export interface PhysicalChannelMeta {
  id: ChannelId;
  quantity: Quantity;
  description: string;
}

export const PHYSICAL_CHANNELS: readonly PhysicalChannelMeta[] = Object.freeze([
  { id: 'speed', quantity: 'speed', description: 'Ground speed of the car along the path.' },
  {
    id: 'long_g',
    quantity: 'accel_g',
    description: 'Longitudinal acceleration (positive forward).',
  },
  { id: 'drag_force', quantity: 'force', description: 'Aerodynamic drag, ½ρ·CdA·v².' },
  { id: 'downforce', quantity: 'force', description: 'Aerodynamic downforce, ½ρ·ClA·v².' },
  {
    id: 'engine_force',
    quantity: 'force',
    description: 'Engine force at the rear wheels, θ·min(F_peak, P/v).',
  },
  { id: 'throttle', quantity: 'percent', description: 'Throttle position, 0 to 1.' },
  {
    id: 'brake',
    quantity: 'percent',
    description: 'Brake pedal, 0 or 1 (the driver brakes at full pedal).',
  },
  { id: 'engine_rpm', quantity: 'rpm', description: 'Engine speed (sawtooth through the gears).' },
  { id: 'gear', quantity: 'gear', description: 'Selected gear, 1 to 6.' },
  { id: 'load_fl', quantity: 'force', description: 'Vertical load on the front-left tire.' },
  { id: 'load_fr', quantity: 'force', description: 'Vertical load on the front-right tire.' },
  { id: 'load_rl', quantity: 'force', description: 'Vertical load on the rear-left tire.' },
  { id: 'load_rr', quantity: 'force', description: 'Vertical load on the rear-right tire.' },
  { id: 'load_front', quantity: 'force', description: 'Total vertical load on the front axle.' },
  { id: 'load_rear', quantity: 'force', description: 'Total vertical load on the rear axle.' },
  {
    id: 'lat_g',
    quantity: 'accel_g',
    description: 'Lateral acceleration v²/r (positive turning left).',
  },
  {
    id: 'steering_angle',
    quantity: 'angle',
    description: 'Geometric steering angle L/r (positive left).',
  },
  { id: 'yaw_rate', quantity: 'rate_deg_s', description: 'Yaw rate v/r (positive turning left).' },
  {
    id: 'heading',
    quantity: 'angle',
    description: 'Heading on the top-down map (0 = east, counter-clockwise).',
  },
  { id: 'pos_x', quantity: 'distance', description: 'Top-down position, x (east).' },
  { id: 'pos_y', quantity: 'distance', description: 'Top-down position, y (north).' },
  { id: 'grip_budget_front', quantity: 'force', description: 'Front axle grip budget Σ μ_i·N_i.' },
  { id: 'grip_budget_rear', quantity: 'force', description: 'Rear axle grip budget Σ μ_i·N_i.' },
  {
    id: 'grip_used_front',
    quantity: 'fraction',
    description: 'Front axle grip used, √(Fx² + Fy²)/F_max.',
  },
  {
    id: 'grip_used_rear',
    quantity: 'fraction',
    description: 'Rear axle grip used, √(Fx² + Fy²)/F_max.',
  },
  {
    id: 'fx_front',
    quantity: 'force',
    description:
      'Front axle longitudinal tire force (+ drive, − braking): the row-12 force actually delivered.',
  },
  {
    id: 'fy_front',
    quantity: 'force',
    description: 'Front axle lateral tire force toward the corner centre, m·a_y·(1−d) (row 18).',
  },
  {
    id: 'fx_rear',
    quantity: 'force',
    description:
      'Rear axle longitudinal tire force (+ drive, − braking): the row-12 force actually delivered.',
  },
  {
    id: 'fy_rear',
    quantity: 'force',
    description: 'Rear axle lateral tire force toward the corner centre, m·a_y·d (row 18).',
  },
  {
    id: 'front_slip_ratio',
    quantity: 'ratio',
    description: 'Front slip ratio (lock under braking).',
  },
  {
    id: 'rear_slip_ratio',
    quantity: 'ratio',
    description: 'Rear slip ratio (wheelspin under drive, lock under braking).',
  },
  { id: 'wheel_speed_fl', quantity: 'speed', description: 'Front-left wheel speed.' },
  { id: 'wheel_speed_fr', quantity: 'speed', description: 'Front-right wheel speed.' },
  { id: 'wheel_speed_rl', quantity: 'speed', description: 'Rear-left wheel speed.' },
  { id: 'wheel_speed_rr', quantity: 'speed', description: 'Rear-right wheel speed.' },
  { id: 'tire_temp_fl', quantity: 'temperature', description: 'Front-left tire temperature.' },
  { id: 'tire_temp_fr', quantity: 'temperature', description: 'Front-right tire temperature.' },
  { id: 'tire_temp_rl', quantity: 'temperature', description: 'Rear-left tire temperature.' },
  { id: 'tire_temp_rr', quantity: 'temperature', description: 'Rear-right tire temperature.' },
  { id: 'brake_temp_front', quantity: 'temperature', description: 'Front brake temperature.' },
  { id: 'brake_temp_rear', quantity: 'temperature', description: 'Rear brake temperature.' },
  {
    id: 'mu_front',
    quantity: 'dimensionless',
    description: 'Front axle mean tire friction coefficient μ_i.',
  },
  {
    id: 'mu_rear',
    quantity: 'dimensionless',
    description: 'Rear axle mean tire friction coefficient μ_i.',
  },
  { id: 'rolling_force', quantity: 'force', description: 'Rolling resistance, crr·m·g.' },
  { id: 'power_used', quantity: 'power', description: 'Engine power delivered, F_engine·v.' },
  {
    id: 'corner_limit_speed',
    quantity: 'speed',
    description: 'Limit speed of the current corner (0 on straights).',
  },
]);

/** Channel ids in `PHYSICAL_CHANNELS` order. */
export const PHYSICAL_CHANNEL_IDS: readonly ChannelId[] = Object.freeze(
  PHYSICAL_CHANNELS.map((c) => c.id),
);
