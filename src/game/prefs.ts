/**
 * UI preferences as persisted signals (contract 06). Framework-free (`@preact/signals-core`), so
 * the same signal objects drive Preact components. Every write is saved under `signal.v1.<key>`;
 * a missing, corrupt or wrong-typed stored value falls back to the default.
 *
 * DOM side-effects live in `src/app/` (the lint boundary keeps this layer DOM-free): the app
 * subscribes with `onProjectorModeChange` and sets the `data-projector` attribute.
 */
import { effect, signal, type Signal } from '@preact/signals-core';
import type { ChannelId } from '@/engine/types';
import { load, save } from '@/persist/storage';
import type { UnitSystem } from '@/units/index';
import type { AxisMode } from './types';

export const PREFS_VERSION = 1;

function persisted<T>(key: string, fallback: T, valid: (x: unknown) => x is T): Signal<T> {
  const stored = load<unknown>(key, PREFS_VERSION, fallback);
  const s = signal<T>(valid(stored) ? stored : fallback);
  let first = true;
  effect(() => {
    const v = s.value;
    if (first) {
      first = false;
      return;
    }
    save(key, PREFS_VERSION, v);
  });
  return s;
}

const isUnits = (x: unknown): x is UnitSystem => x === 'metric' || x === 'imperial';
const isAxis = (x: unknown): x is AxisMode => x === 'time' || x === 'distance';
const isIds = (x: unknown): x is ChannelId[] =>
  Array.isArray(x) && x.every((v) => typeof v === 'string');
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';

/** `signal.v1.units`, default `'metric'`. */
export const units: Signal<UnitSystem> = persisted<UnitSystem>('units', 'metric', isUnits);
/** `signal.v1.axis`, default `'time'`. */
export const axisMode: Signal<AxisMode> = persisted<AxisMode>('axis', 'time', isAxis);
/** `signal.v1.layout`: the strip stack, global across levels (spec). Empty = level defaults. */
export const stripLayout: Signal<ChannelId[]> = persisted<ChannelId[]>('layout', [], isIds);
/** `signal.v1.projector`, default off. */
export const projectorMode: Signal<boolean> = persisted<boolean>('projector', false, isBool);

/** `signal.v1.axisPhaseB`: whether Phase B has already forced the distance axis once. */
const phaseBAxisApplied: Signal<boolean> = persisted<boolean>('axisPhaseB', false, isBool);

/**
 * Phase B forces the default axis to `'distance'` on first entry (contract 06). Call when a
 * Phase B level opens; later player choices stick.
 */
export function enterPhaseB(): void {
  if (phaseBAxisApplied.value) return;
  phaseBAxisApplied.value = true;
  axisMode.value = 'distance';
}

/**
 * DOM-free hook for projector mode: calls `fn` now and on every change; returns an unsubscribe.
 * `src/app/projector-binding.ts` uses it to set `data-projector` on `<html>`.
 */
export function onProjectorModeChange(fn: (on: boolean) => void): () => void {
  return effect(() => {
    fn(projectorMode.value);
  });
}
