import { describe, expect, it } from 'vitest';
import { readPlaybackFlag } from '@/app/bindings';
import { readoutText } from '@/report/GripCircle';
import { displayBounds, minSpan, QUANTITIES, UNIT_SYSTEMS } from '@/units';

describe('?playback=instant (Stage 10 tests flag)', () => {
  it('reads the flag before or inside the hash', () => {
    expect(readPlaybackFlag({ search: '?playback=instant', hash: '#/level/A1' })).toBe('instant');
    expect(readPlaybackFlag({ search: '', hash: '#/level/A1?playback=realtime' })).toBe('realtime');
    expect(readPlaybackFlag({ search: '?playback=fast', hash: '' })).toBeNull();
    expect(readPlaybackFlag({ search: '', hash: '' })).toBeNull();
    expect(readPlaybackFlag(undefined)).toBeNull();
  });
});

describe('grip readout line', () => {
  it('`0.85 g lat · 0.20 g long · 87 % of grip`, dropping parts a level does not log', () => {
    expect(readoutText({ latG: 0.851, longG: -0.2, used: 0.87 })).toBe(
      '0.85 g lat · 0.20 g long · 87 % of grip',
    );
    expect(readoutText({ latG: NaN, longG: 0.52, used: 0.36 })).toBe('0.52 g long · 36 % of grip');
  });
});

describe('minimum visible y span (Stage 10, units layer)', () => {
  it('per quantity, converted with the unit factor', () => {
    expect(minSpan('percent', 'metric')).toBeCloseTo(20, 9);
    expect(minSpan('temperature', 'metric')).toBeCloseTo(10, 9);
    expect(minSpan('temperature', 'imperial')).toBeCloseTo(18, 9); // a span ignores the offset
    expect(minSpan('speed', 'metric')).toBeCloseTo(20, 9);
    expect(minSpan('speed', 'imperial')).toBeCloseTo(20 / 1.609344, 6);
    expect(minSpan('accel_g', 'metric')).toBe(0.5);
    for (const q of QUANTITIES) {
      for (const sys of UNIT_SYSTEMS) expect(minSpan(q, sys)).toBeGreaterThan(0);
    }
    expect(displayBounds('percent', 'metric')).toEqual([0, 100]);
    expect(displayBounds('speed', 'metric')).toBeUndefined();
  });
});
