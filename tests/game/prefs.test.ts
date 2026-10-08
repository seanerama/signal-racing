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
  it('defaults: metric, distance axis (Stage 10), empty layout, projector off, 1× real-time playback, default density', async () => {
    const p = await import('@/game/prefs');
    expect(p.units.value).toBe('metric');
    expect(p.axisMode.value).toBe('distance');
    expect(p.stripLayout.value).toEqual([]);
    expect(p.projectorMode.value).toBe(false);
    expect(p.playbackSpeed.value).toBe(1);
    expect(p.playbackMode.value).toBe('realtime');
    expect(p.density.value).toBe('default');
    expect(store.length).toBe(0); // defaults are not written
  });

  it('a v0.3 time-axis default under the old key does not carry over', async () => {
    store.setItem('signal.v1.axis', JSON.stringify({ v: 1, data: 'time' }));
    const p = await import('@/game/prefs');
    expect(p.axisMode.value).toBe('distance');
  });

  it('playback speed, playback mode and density persist; wrong values fall back', async () => {
    let p = await import('@/game/prefs');
    p.playbackSpeed.value = 4;
    p.playbackMode.value = 'instant';
    p.density.value = 'compact';
    vi.resetModules();
    p = await import('@/game/prefs');
    expect(p.playbackSpeed.value).toBe(4);
    expect(p.playbackMode.value).toBe('instant');
    expect(p.density.value).toBe('compact');
    store.setItem('signal.v1.playbackSpeed', JSON.stringify({ v: 1, data: 3 }));
    vi.resetModules();
    p = await import('@/game/prefs');
    expect(p.playbackSpeed.value).toBe(1);
  });

  it('persists writes under signal.v1.* and reloads them', async () => {
    let p = await import('@/game/prefs');
    p.units.value = 'imperial';
    p.axisMode.value = 'time';
    p.stripLayout.value = ['speed', 'oil_temp'];
    p.projectorMode.value = true;
    expect(JSON.parse(store.getItem('signal.v1.units')!)).toEqual({ v: 1, data: 'imperial' });
    expect(store.getItem('signal.v1.axisMode')).toContain('time');
    expect(store.getItem('signal.v1.layout')).toContain('oil_temp');
    vi.resetModules();
    p = await import('@/game/prefs');
    expect(p.units.value).toBe('imperial');
    expect(p.axisMode.value).toBe('time');
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

  it('entering Phase B no longer changes the axis (distance is the default everywhere)', async () => {
    const p = await import('@/game/prefs');
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
