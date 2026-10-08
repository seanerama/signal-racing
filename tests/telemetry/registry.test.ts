import { describe, expect, it } from 'vitest';
import type { Quantity } from '@/engine/types';
import { QUANTITIES } from '@/units';
import { ECHO_FAMILIES } from '@/telemetry/distractors';
import { PHYSICAL_CHANNEL_SPECS } from '@/telemetry/physical-defs';
import {
  GROUP_ORDER,
  allChannels,
  channelQuantum,
  channelRange,
  getChannel,
  hasChannel,
  inRegistryOrder,
  registryIndex,
} from '@/telemetry/registry';

/** Contract 02, "Physical channels produced", restated independently of physical-defs.ts. */
const CONTRACT_02: Record<string, Quantity> = {
  speed: 'speed',
  long_g: 'accel_g',
  drag_force: 'force',
  downforce: 'force',
  engine_force: 'force',
  throttle: 'percent',
  brake: 'percent',
  engine_rpm: 'rpm',
  gear: 'gear',
  load_fl: 'force',
  load_fr: 'force',
  load_rl: 'force',
  load_rr: 'force',
  lat_g: 'accel_g',
  steering_angle: 'angle',
  heading: 'angle',
  grip_budget_front: 'force',
  grip_budget_rear: 'force',
  grip_used_front: 'fraction',
  grip_used_rear: 'fraction',
  front_slip_ratio: 'ratio',
  rear_slip_ratio: 'ratio',
  wheel_speed_fl: 'speed',
  wheel_speed_fr: 'speed',
  wheel_speed_rl: 'speed',
  wheel_speed_rr: 'speed',
  tire_temp_fl: 'temperature',
  tire_temp_fr: 'temperature',
  tire_temp_rl: 'temperature',
  tire_temp_rr: 'temperature',
  brake_temp_front: 'temperature',
  brake_temp_rear: 'temperature',
  mu_front: 'dimensionless',
  mu_rear: 'dimensionless',
  rolling_force: 'force',
  power_used: 'power',
  load_front: 'force',
  load_rear: 'force',
  yaw_rate: 'rate_deg_s',
  pos_x: 'distance',
  pos_y: 'distance',
  corner_limit_speed: 'speed',
};

const DERIVED = [
  'delta_best',
  'segment_time',
  'segment_delta',
  'speed_diff_rl',
  'speed_diff_rr',
  'top_speed',
  'corner_min_speed',
  'exit_speed',
];

const BANNED_PREFIXES = ['dummy_', 'noise_', 'fake_', 'test_'];

describe('channel registry', () => {
  const all = allChannels();

  it('has at least 200 channels (the Puzzle set)', () => {
    expect(all.length).toBeGreaterThanOrEqual(200);
  });

  it('ids are unique snake_case with no banned prefixes', () => {
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      for (const p of BANNED_PREFIXES) expect(id.startsWith(p), id).toBe(false);
      expect(id).not.toMatch(/dummy|fake|noise|random|irrelevant|distractor/);
    }
  });

  it('every contract-02 physical channel is present, physical, with the contract quantity', () => {
    for (const [id, q] of Object.entries(CONTRACT_02)) {
      expect(hasChannel(id), id).toBe(true);
      const def = getChannel(id);
      expect(def.source.kind, id).toBe('physical');
      expect(def.quantity, id).toBe(q);
    }
    const physical = all.filter((c) => c.source.kind === 'physical').map((c) => c.id);
    expect(new Set(physical)).toEqual(new Set(Object.keys(CONTRACT_02)));
    expect(PHYSICAL_CHANNEL_SPECS.map((s) => s.id)).toEqual(physical);
  });

  it('registers the corner channels from contract 02', () => {
    for (const id of [
      'lat_g',
      'yaw_rate',
      'steering_angle',
      'pos_x',
      'pos_y',
      'heading',
      'corner_limit_speed',
    ]) {
      expect(hasChannel(id), id).toBe(true);
    }
  });

  it('provides the derived channels', () => {
    for (const id of DERIVED) expect(getChannel(id).source.kind, id).toBe('derived');
  });

  it('pos_x, pos_y and heading carry zero noise and no dropouts', () => {
    for (const id of ['pos_x', 'pos_y', 'heading']) {
      expect(getChannel(id).noise).toEqual({ sigmaFrac: 0, dropoutRate: 0 });
    }
  });

  it('every other sensor channel has 1–3% noise and ≤ 0.2% dropouts', () => {
    for (const c of all) {
      if (['pos_x', 'pos_y', 'heading'].includes(c.id)) continue;
      if (c.source.kind === 'derived') {
        // Math channels inherit their inputs' noise; they add none of their own.
        expect(c.noise, c.id).toEqual({ sigmaFrac: 0, dropoutRate: 0 });
        continue;
      }
      expect(c.noise.sigmaFrac, c.id).toBeGreaterThanOrEqual(0.01);
      expect(c.noise.sigmaFrac, c.id).toBeLessThanOrEqual(0.03);
      expect(c.noise.dropoutRate, c.id).toBeGreaterThan(0);
      expect(c.noise.dropoutRate, c.id).toBeLessThanOrEqual(0.002);
    }
  });

  it('every def has a label, a known quantity and group, and a positive range', () => {
    for (const c of all) {
      expect(c.label.length, c.id).toBeGreaterThan(2);
      expect(QUANTITIES).toContain(c.quantity);
      expect(GROUP_ORDER).toContain(c.group);
      const [lo, hi] = channelRange(c.id);
      expect(hi, c.id).toBeGreaterThan(lo);
    }
  });

  it('distractor params are complete and in range', () => {
    const distractors = all.filter((c) => c.source.kind === 'distractor');
    expect(distractors.length).toBeGreaterThanOrEqual(150);
    for (const c of distractors) {
      if (c.source.kind !== 'distractor') continue;
      const { lo, hi } = c.source.params;
      expect(lo, c.id).toBeTypeOf('number');
      expect(hi!, c.id).toBeGreaterThan(lo!);
      expect(channelRange(c.id)).toEqual([lo, hi]);
    }
    // Echo families exist but stay a minority.
    const echoes = distractors.filter(
      (c) => c.source.kind === 'distractor' && ECHO_FAMILIES.includes(c.source.family),
    );
    expect(echoes.length).toBeGreaterThan(5);
    expect(echoes.length).toBeLessThan(distractors.length / 4);
  });

  it('includes the per-corner and numbered sensor families', () => {
    for (const id of [
      'damper_pos_fl',
      'damper_pos_rr',
      'strain_tierod_fl',
      'pitot_dp_1',
      'pitot_dp_8',
      'ecu_temp',
      'cell_temp_01',
      'cell_temp_24',
      'oil_temp',
      'battery_voltage',
      'fuel_pressure',
      'gps_altitude',
      'radio_rssi',
      'intake_air_temp',
    ]) {
      expect(hasChannel(id), id).toBe(true);
    }
  });

  it('quantises digital channels only', () => {
    expect(channelQuantum('gear')).toBe(1);
    expect(channelQuantum('drs_status')).toBe(1);
    expect(channelQuantum('speed')).toBeUndefined();
  });

  it('lookup API: getChannel throws on unknown ids, registry order is stable', () => {
    expect(() => getChannel('nope')).toThrow(/unknown channel/);
    expect(hasChannel('nope')).toBe(false);
    expect(registryIndex('speed')).toBe(0);
    expect(inRegistryOrder(['oil_temp', 'speed', 'delta_best', 'speed'])).toEqual([
      'speed',
      'delta_best',
      'oil_temp',
    ]);
    expect(() => inRegistryOrder(['nope'])).toThrow();
  });
});
