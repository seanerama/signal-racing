import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './memory-storage';

let store: MemoryStorage;
beforeEach(() => {
  vi.resetModules(); // prefs read storage at import time
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prefs', () => {
  it('defaults: metric, time axis, empty layout, projector off', async () => {
    const p = await import('@/game/prefs');
    expect(p.units.value).toBe('metric');
    expect(p.axisMode.value).toBe('time');
    expect(p.stripLayout.value).toEqual([]);
    expect(p.projectorMode.value).toBe(false);
    expect(store.length).toBe(0); // defaults are not written
  });

  it('persists writes under signal.v1.* and reloads them', async () => {
    let p = await import('@/game/prefs');
    p.units.value = 'imperial';
    p.axisMode.value = 'distance';
    p.stripLayout.value = ['speed', 'oil_temp'];
    p.projectorMode.value = true;
    expect(JSON.parse(store.getItem('signal.v1.units')!)).toEqual({ v: 1, data: 'imperial' });
    expect(store.getItem('signal.v1.axis')).toContain('distance');
    expect(store.getItem('signal.v1.layout')).toContain('oil_temp');
    vi.resetModules();
    p = await import('@/game/prefs');
    expect(p.units.value).toBe('imperial');
    expect(p.axisMode.value).toBe('distance');
    expect(p.stripLayout.value).toEqual(['speed', 'oil_temp']);
    expect(p.projectorMode.value).toBe(true);
  });

  it('wrong-typed stored values fall back to defaults', async () => {
    store.setItem('signal.v1.units', JSON.stringify({ v: 1, data: 'furlongs' }));
    store.setItem('signal.v1.layout', JSON.stringify({ v: 1, data: [1, 2] }));
    const p = await import('@/game/prefs');
    expect(p.units.value).toBe('metric');
    expect(p.stripLayout.value).toEqual([]);
  });

  it('Phase B forces the distance axis once', async () => {
    const p = await import('@/game/prefs');
    p.enterPhaseB();
    expect(p.axisMode.value).toBe('distance');
    p.axisMode.value = 'time';
    p.enterPhaseB();
    expect(p.axisMode.value).toBe('time');
  });

  it('onProjectorModeChange: DOM-free hook, called now and on change, unsubscribable', async () => {
    const p = await import('@/game/prefs');
    const seen: boolean[] = [];
    const stop = p.onProjectorModeChange((on) => seen.push(on));
    p.projectorMode.value = true;
    p.projectorMode.value = false;
    stop();
    p.projectorMode.value = true;
    expect(seen).toEqual([false, true, false]);
  });
});
