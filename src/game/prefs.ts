/**
 * UI preferences as persisted signals (contract 06). Framework-free (`@preact/signals-core`), so
 * the same signal objects drive Preact components. Every write is saved under `signal.v1.<key>`;
 * a missing, corrupt or wrong-typed stored value falls back to the default.
 *
 * DOM side-effects live in `src/app/` (the lint boundary keeps this layer DOM-free): the app
 * subscribes with `onProjectorModeChange` / `onDensityChange` and sets the `data-projector` /
 * `data-density` attributes on `<html>`.
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
/**
 * `signal.v1.axisMode`, default `'distance'` (Stage 10: the style guide's default for comparing
 * runs, on every level). A new key, so the v0.3 default of `'time'` stored under `axis` does not
 * carry over; a player's later choice persists.
 */
export const axisMode: Signal<AxisMode> = persisted<AxisMode>('axisMode', 'distance', isAxis);
/** `signal.v1.layout`: the strip stack, global across levels (spec). Empty = level defaults. */
export const stripLayout: Signal<ChannelId[]> = persisted<ChannelId[]>('layout', [], isIds);
/**
 * `signal.v1.layoutSmooth` (Stage 9): channels whose strip is drawn with the display-only 5-point
 * smoothing. Part of the layout prefs, global like the stack; a channel keeps its setting when it
 * leaves and re-enters the stack.
 */
export const stripSmooth: Signal<ChannelId[]> = persisted<ChannelId[]>('layoutSmooth', [], isIds);
/** `signal.v1.projector`, default off. */
export const projectorMode: Signal<boolean> = persisted<boolean>('projector', false, isBool);

/**
 * Phase B used to force the distance axis on first entry (contract 06). Since Stage 10 distance
 * is the default on every level, so this is a no-op kept for callers.
 */
export function enterPhaseB(): void {}

export type PlaybackSpeed = 1 | 2 | 4;
export type PlaybackMode = 'realtime' | 'instant';
export type Density = 'default' | 'compact';
const isSpeed = (x: unknown): x is PlaybackSpeed => x === 1 || x === 2 || x === 4;
const isMode = (x: unknown): x is PlaybackMode => x === 'realtime' || x === 'instant';
const isDensity = (x: unknown): x is Density => x === 'default' || x === 'compact';

/** `signal.v1.playbackSpeed`: run playback speed, default 1×. */
export const playbackSpeed: Signal<PlaybackSpeed> = persisted<PlaybackSpeed>(
  'playbackSpeed',
  1,
  isSpeed,
);
/**
 * `signal.v1.playbackMode`: `'realtime'` plays each new run back (default); `'instant'` shows it
 * complete at once (set by the `?playback=instant` URL flag; used by e2e and unit tests).
 */
export const playbackMode: Signal<PlaybackMode> = persisted<PlaybackMode>(
  'playbackMode',
  'realtime',
  isMode,
);
/** `signal.v1.density`: `'default'` (readable working density) or `'compact'` (dense). */
export const density: Signal<Density> = persisted<Density>('density', 'default', isDensity);

/** DOM-free hook for density: calls `fn` now and on every change; returns an unsubscribe. */
export function onDensityChange(fn: (d: Density) => void): () => void {
  return effect(() => {
    fn(density.value);
  });
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
