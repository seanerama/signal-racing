/**
 * Real-time run playback (Stage 10, Vision Lead direction). The engine still computes the whole
 * run instantly; the UI then plays it back: the strips draw progressively up to the playhead,
 * the car moves along the track, the grip circle follows and the header shows a live time and
 * speed. Final results appear when playback ends (`gating`).
 *
 * - `playhead` is a sample index into the run being played (null = not playing: draw in full).
 *   The shared cursor follows it, so the track view, the grip circle and every strip readout
 *   move with it.
 * - Speed 1×/2×/4× may change mid-play; Pause/Resume; Skip finishes instantly.
 * - One rAF loop, only while playing; nothing runs when idle.
 * - `frameStats()` reports the per-frame work time measured inside the loop (signals set, the
 *   synchronous redraws, and the Preact render microtask that follows), for the perf check.
 */
import { signal, type Signal } from '@preact/signals';
import { cursorIdx, cursorPinned, stopReplay } from './cursor-store';

export type PlayState = 'idle' | 'playing' | 'paused';
export type Speed = 1 | 2 | 4;

export interface PlaybackInfo {
  /** Run index (1-based) being played. */
  runIndex: number;
  /** Samples in the run. */
  n: number;
  /** s per sample. */
  dt: number;
  /** True for the first playback of a new run: results stay hidden until it ends. */
  gating: boolean;
}

/** Sample index of the playhead; null when nothing is playing (traces drawn in full). */
export const playhead: Signal<number | null> = signal<number | null>(null);
export const playState: Signal<PlayState> = signal<PlayState>('idle');
/** What is being played (null when idle). */
export const playing: Signal<PlaybackInfo | null> = signal<PlaybackInfo | null>(null);
/** Current speed; the app seeds it from the persisted pref and writes changes back. */
export const playSpeed: Signal<Speed> = signal<Speed>(1);

let rafId: number | null = null;
let simT = 0;
let lastWall = 0;
const frameMs: number[] = [];
const intervalMs: number[] = [];
let lastFrameStart = 0;

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function setHead(idx: number): void {
  playhead.value = idx;
  cursorPinned.value = false;
  cursorIdx.value = idx;
}

function frame(): void {
  rafId = null;
  const info = playing.value;
  if (!info || playState.value !== 'playing') return;
  const t0 = now();
  if (lastFrameStart > 0) intervalMs.push(t0 - lastFrameStart);
  lastFrameStart = t0;
  simT += ((t0 - lastWall) / 1000) * playSpeed.value;
  lastWall = t0;
  const idx = Math.min(info.n - 1, Math.floor(simT / info.dt));
  if (idx >= info.n - 1) {
    finish();
    return;
  }
  setHead(idx);
  // The Preact re-render is a microtask queued by the signal writes above; this one runs after.
  queueMicrotask(() => {
    frameMs.push(now() - t0);
    if (frameMs.length > 4000) frameMs.splice(0, 2000);
  });
  rafId = globalThis.requestAnimationFrame(frame);
}

function schedule(): void {
  if (rafId === null && typeof globalThis.requestAnimationFrame === 'function') {
    lastWall = now();
    rafId = globalThis.requestAnimationFrame(frame);
  }
}

function cancel(): void {
  if (rafId !== null) globalThis.cancelAnimationFrame?.(rafId);
  rafId = null;
  lastFrameStart = 0;
}

/** Ends playback: traces in full, results revealed. The cursor stays at the last sample. */
export function finish(): void {
  const info = playing.value;
  cancel();
  playing.value = null;
  playState.value = 'idle';
  playhead.value = null;
  if (info) cursorIdx.value = info.n - 1;
}

/** Starts playing a run from its first sample (restarts if something is already playing). */
export function startPlayback(info: PlaybackInfo): void {
  cancel();
  stopReplay();
  if (info.n <= 1 || !(info.dt > 0)) {
    finish();
    return;
  }
  simT = 0;
  playing.value = info;
  playState.value = 'playing';
  setHead(0);
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    finish();
    return;
  }
  schedule();
}

export function pausePlayback(): void {
  if (playState.value !== 'playing') return;
  cancel();
  playState.value = 'paused';
}

export function resumePlayback(): void {
  if (playState.value !== 'paused') return;
  playState.value = 'playing';
  schedule();
}

export function togglePause(): void {
  if (playState.value === 'playing') pausePlayback();
  else resumePlayback();
}

/** Skip: finish instantly. */
export function skipPlayback(): void {
  if (playState.value !== 'idle') finish();
}

export function setPlaySpeed(s: Speed): void {
  playSpeed.value = s;
}

/** True while `runIndex` is being played for the first time (its results are still hidden). */
export function isGated(runIndex: number | undefined): boolean {
  const p = playing.value;
  return !!p && p.gating && p.runIndex === runIndex;
}

export interface FrameStats {
  frames: number;
  /** Per-frame work (ms): mean, 95th percentile and max. */
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  /** Interval between frames (ms): mean and 95th percentile. */
  meanIntervalMs: number;
  p95IntervalMs: number;
}

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Frame timings since the last `resetFrameStats()` (perf check; exposed on `window` in app). */
export function frameStats(): FrameStats {
  return {
    frames: frameMs.length,
    meanMs: mean(frameMs),
    p95Ms: pct(frameMs, 0.95),
    maxMs: frameMs.length ? Math.max(...frameMs) : 0,
    meanIntervalMs: mean(intervalMs),
    p95IntervalMs: pct(intervalMs, 0.95),
  };
}

export function resetFrameStats(): void {
  frameMs.length = 0;
  intervalMs.length = 0;
}

/** Test hook / level change: stop everything. */
export function resetPlayback(): void {
  cancel();
  playing.value = null;
  playState.value = 'idle';
  playhead.value = null;
}
