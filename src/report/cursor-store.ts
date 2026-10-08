/**
 * The shared cursor (contract 07). One sample index into the *current* run, read and written by
 * every strip and by non-uPlot views such as the track view.
 *
 * - StripStack writes `cursorIdx` on hover, on pin and on keyboard step, and pushes it into every
 *   uPlot instance when it changes from anywhere else (Replay, track view, keyboard).
 * - Replay is the only thing that moves the cursor on its own, and only when the player starts it:
 *   rAF-driven in real time (1× or 4×). It stops on Esc, at the end of the run, or on any pointer
 *   input on a strip (StripStack calls `stopReplay()`).
 */
import { signal, type Signal } from '@preact/signals';

/** Sample index into the current run; null = no cursor (track view parks the block at the start). */
export const cursorIdx: Signal<number | null> = signal<number | null>(null);
/** True while the cursor is pinned by a click (the line turns solid `--text`). */
export const cursorPinned: Signal<boolean> = signal(false);
/** True while a Replay sweep is running. */
export const replaying: Signal<boolean> = signal(false);

let rafId: number | null = null;
let escListener: ((ev: KeyboardEvent) => void) | null = null;

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/** Stops a running Replay; the cursor stays where the sweep left it. No-op when idle. */
export function stopReplay(): void {
  if (rafId !== null) {
    globalThis.cancelAnimationFrame?.(rafId);
    rafId = null;
  }
  if (escListener) {
    globalThis.removeEventListener?.('keydown', escListener, true);
    escListener = null;
  }
  replaying.value = false;
}

/**
 * Sweeps the cursor from sample 0 to `n - 1` in real time: `dt` seconds per sample, at `speed`×.
 * Restarts if a Replay is already running.
 */
export function startReplay(n: number, dt: number, speed: 1 | 4): void {
  stopReplay();
  if (n <= 0 || !(dt > 0)) return;
  const last = n - 1;
  const t0 = now();
  cursorPinned.value = false;
  cursorIdx.value = 0;
  replaying.value = true;

  escListener = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      stopReplay();
    }
  };
  globalThis.addEventListener?.('keydown', escListener, true);

  const frame = () => {
    const elapsed = (now() - t0) / 1000;
    const idx = Math.floor((elapsed * speed) / dt);
    if (idx >= last) {
      cursorIdx.value = last;
      rafId = null;
      stopReplay();
      return;
    }
    cursorIdx.value = idx;
    rafId = globalThis.requestAnimationFrame(frame);
  };
  rafId = globalThis.requestAnimationFrame(frame);
}

/** Toggles Replay (Space). */
export function toggleReplay(n: number, dt: number, speed: 1 | 4): void {
  if (replaying.value) stopReplay();
  else startReplay(n, dt, speed);
}

/** Pins the cursor at `idx` (or unpins when `idx` is null). */
export function pinCursor(idx: number | null): void {
  if (idx === null) {
    cursorPinned.value = false;
    return;
  }
  cursorIdx.value = idx;
  cursorPinned.value = true;
}

/** Steps a pinned cursor by `delta` samples, clamped to `[0, n - 1]`. Returns false if not pinned. */
export function stepCursor(delta: number, n: number): boolean {
  if (!cursorPinned.value || n <= 0) return false;
  const cur = cursorIdx.value ?? 0;
  cursorIdx.value = Math.max(0, Math.min(n - 1, cur + delta));
  return true;
}

/** Resets all cursor state (tests, level change). */
export function resetCursor(): void {
  stopReplay();
  cursorIdx.value = null;
  cursorPinned.value = false;
}
