import { describe, expect, it } from 'vitest';
import type { Setup } from '@/engine/types';
import { toCsv } from '@/export/csv';
import { allChannels } from '@/telemetry/registry';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import type { RunTelemetry } from '@/telemetry/types';
import { unitLabel } from '@/units';
import { CORNER_TRACK, makeFixture } from '../telemetry/fixtures';

const SETUP: Setup = { throttle_ramp: 0.4, tire_pressure: 1.65, weight_dist: 0.45, wing: 4 };
const pc = makeFixture({ segments: CORNER_TRACK });

/** Minimal CSV parse: comment lines, then rows of cells (no quoted cells occur in our output). */
function parse(csv: string): { comments: string[]; rows: string[][] } {
  const lines = csv.trimEnd().split('\n');
  const comments = lines.filter((l) => l.startsWith('#'));
  const rows = lines.filter((l) => !l.startsWith('#')).map((l) => l.split(','));
  return { comments, rows };
}

describe('toCsv', () => {
  const ids = ['speed', 'throttle', 'tire_temp_rl', 'oil_temp', 'delta_best', 'gear'];
  const rt = createRunTelemetry({ physical: pc, channelIds: ids, seed: 7 });

  it('writes the preamble, header and units row', () => {
    const csv = toCsv(rt, { levelId: 'A2', run: 3, seed: 7, setup: SETUP, units: 'metric' });
    const { comments, rows } = parse(csv);
    expect(comments[0]).toMatch(/^# signal v0\.\d+$/);
    expect(comments).toContain('# level: A2');
    expect(comments).toContain('# run: 3');
    expect(comments).toContain('# seed: 7');
    expect(comments).toContain('# units: metric');
    expect(comments).toContain(`# setup: ${JSON.stringify(SETUP)}`);
    expect(rows[0]).toEqual(['t', 's', ...rt.channelIds]);
    expect(rows[1]).toEqual(['s', 'm', 'km/h', '%', '', '°C', 's', '°C']);
    expect(rows.length).toBe(2 + rt.n);
    for (const r of rows) expect(r.length).toBe(rows[0]!.length);
  });

  it('formats values in display units with precision(), NaN as an empty cell', () => {
    const { rows } = parse(
      toCsv(rt, { levelId: 'A2', run: 1, seed: 7, setup: SETUP, units: 'metric' }),
    );
    const speedCol = rows[0]!.indexOf('speed');
    const noisy = rt.get('speed');
    let sawEmpty = false;
    for (let i = 0; i < rt.n; i++) {
      const cell = rows[2 + i]![speedCol]!;
      if (Number.isNaN(noisy[i]!)) {
        expect(cell).toBe('');
        sawEmpty = true;
      } else {
        expect(cell).toMatch(/^-?\d+\.\d$/); // speed: 1 dp
        expect(Number(cell)).toBeCloseTo(noisy[i]! * 3.6, 1);
      }
    }
    expect(rows[2]![0]).toBe('0.000'); // time: 3 dp
    const gearCol = rows[0]!.indexOf('gear');
    expect(rows[2]![gearCol]).toMatch(/^(\d+)?$/); // gear: integer
    // Somewhere in the run there is at least one dropout somewhere in the file.
    const anyEmpty = rows.slice(2).some((r) => r.includes(''));
    expect(anyEmpty || sawEmpty).toBe(true);
    expect(rows.slice(2).every((r) => r.every((c) => !c.startsWith('-0') || /[1-9]/.test(c)))).toBe(
      true,
    );
  });

  it('imperial export converts values and unit labels', () => {
    const metric = parse(
      toCsv(rt, { levelId: 'A2', run: 1, seed: 7, setup: SETUP, units: 'metric' }),
    ).rows;
    const imperial = parse(
      toCsv(rt, { levelId: 'A2', run: 1, seed: 7, setup: SETUP, units: 'imperial' }),
    ).rows;
    expect(imperial[1]).toEqual(['s', 'ft', 'mph', '%', '', '°F', 's', '°F']);
    const col = metric[0]!.indexOf('speed');
    const sCol = metric[0]!.indexOf('s');
    const tempCol = metric[0]!.indexOf('tire_temp_rl');
    const i = 2 + Math.floor(rt.n / 2);
    if (metric[i]![col] !== '') {
      expect(Number(imperial[i]![col])).toBeCloseTo(Number(metric[i]![col]) / 1.609344, 0);
    }
    expect(Number(imperial[i]![sCol])).toBeCloseTo(Number(metric[i]![sCol]) / 0.3048, -1);
    if (metric[i]![tempCol] !== '') {
      expect(Number(imperial[i]![tempCol])).toBeCloseTo(Number(metric[i]![tempCol]) * 1.8 + 32, 0);
    }
  });

  it('a full Puzzle set exports 200+ channel columns and round-trips', () => {
    const all = allChannels().map((c) => c.id);
    const full: RunTelemetry = createRunTelemetry({ physical: pc, channelIds: all, seed: 9 });
    const csv = toCsv(full, { levelId: 'B4L', run: 1, seed: 9, setup: SETUP, units: 'imperial' });
    const { rows } = parse(csv);
    expect(rows[0]!.length).toBe(2 + all.length);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(202);
    expect(rows[1]!.length).toBe(rows[0]!.length);
    expect(rows[1]![2]).toBe(unitLabel('speed', 'imperial'));
    for (const r of rows) expect(r.length).toBe(rows[0]!.length);
    expect(rows.length).toBe(2 + full.n);
    // Every value cell is empty or a plain number.
    for (const r of rows.slice(2, 50))
      for (const c of r) expect(c === '' || Number.isFinite(Number(c))).toBe(true);
  });
});
