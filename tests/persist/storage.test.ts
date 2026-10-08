import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load, save, storageKey } from '@/persist/storage';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

describe('storage', () => {
  let store: MemoryStorage;

  beforeEach(() => {
    store = new MemoryStorage();
    vi.stubGlobal('localStorage', store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('namespaces keys under signal.v1.', () => {
    expect(storageKey('progress')).toBe('signal.v1.progress');
    expect(storageKey('signal.v1.units')).toBe('signal.v1.units');
  });

  it('round-trips a value at the same version', () => {
    save('progress', 1, { a: 1, b: [1, 2] });
    expect(store.getItem('signal.v1.progress')).not.toBeNull();
    expect(load('progress', 1, null)).toEqual({ a: 1, b: [1, 2] });
  });

  it('missing key → fallback', () => {
    expect(load('nope', 1, 'fb')).toBe('fb');
  });

  it('version mismatch → fallback', () => {
    save('units', 1, 'imperial');
    expect(load('units', 2, 'metric')).toBe('metric');
    expect(console.warn).toHaveBeenCalled();
  });

  it('corrupt JSON → fallback', () => {
    store.setItem('signal.v1.layout', '{not json');
    expect(load('layout', 1, ['speed'])).toEqual(['speed']);
  });

  it('valid JSON without an envelope → fallback', () => {
    store.setItem('signal.v1.layout', '["speed"]');
    expect(load('layout', 1, [])).toEqual([]);
  });

  it('throwing localStorage → fallback on load, no throw on save', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    vi.stubGlobal('localStorage', throwing);
    expect(() => load('progress', 1, 'fb')).not.toThrow();
    expect(load('progress', 1, 'fb')).toBe('fb');
    expect(() => save('progress', 1, { x: 1 })).not.toThrow();
  });

  it('localStorage getter that throws → fallback, no throw', () => {
    vi.unstubAllGlobals();
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('access denied');
      },
    });
    try {
      expect(load('progress', 1, 'fb')).toBe('fb');
      expect(() => save('progress', 1, 1)).not.toThrow();
    } finally {
      if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('unserialisable value → no throw', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => save('cyclic', 1, cyclic)).not.toThrow();
  });
});
