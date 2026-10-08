import { describe, expect, it } from 'vitest';
import { readDemoFlag } from '@/app/demo-flag';

describe('?demo=1', () => {
  it('reads the flag before or inside the hash', () => {
    expect(readDemoFlag({ search: '?demo=1', hash: '#/level/B4L' })).toBe(true);
    expect(readDemoFlag({ search: '', hash: '#/level/B4L?demo=1' })).toBe(true);
    expect(readDemoFlag({ search: '?demo=true', hash: '' })).toBe(true);
    expect(readDemoFlag({ search: '', hash: '#/level/B4L' })).toBe(false);
    expect(readDemoFlag({ search: '?demo=0', hash: '' })).toBe(false);
    expect(readDemoFlag(undefined)).toBe(false);
  });
});
