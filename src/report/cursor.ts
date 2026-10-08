/**
 * uPlot cursor wiring (design-system "Cursor"): the sync group, click-to-pin, keyboard stepping,
 * and pushing the shared `cursorIdx` into every strip.
 *
 * - Hover moves the cursor on every strip through the `uPlot.sync` group, and the `setCursor`
 *   hook writes `cursorIdx`.
 * - Click pins (the line turns solid `--text`); click again unpins. While pinned, hover is
 *   ignored and `←/→` step one sample (`Shift` ten).
 * - Any pointer input on a strip stops a running Replay.
 * - Plain mousedown never starts a drag selection; only Shift+drag does (zoom, see zoom.ts).
 */
import type uPlot from 'uplot';
import {
  cursorIdx,
  cursorPinned,
  pinCursor,
  replaying,
  stepCursor,
  stopReplay,
} from './cursor-store';
import { resetZoom } from './zoom';

/** `cursor.bind` overrides for every strip. */
export function cursorBind(): uPlot.Cursor.Bind {
  return {
    mousedown: (_u, _t, handler) => (e) => {
      if (replaying.value) stopReplay();
      // Shift+drag selects a zoom range; a plain press is a click (pin), never a drag.
      return e.shiftKey ? handler(e) : null;
    },
    mousemove: (_u, _t, handler) => (e) => {
      if (replaying.value) stopReplay();
      return cursorPinned.value ? null : handler(e);
    },
    mouseleave: (_u, _t, handler) => (e) => {
      return cursorPinned.value || replaying.value ? null : handler(e);
    },
    dblclick: () => () => {
      resetZoom();
      return null;
    },
  };
}

/** `setCursor` hook: hover writes the shared cursor (not while pinned or replaying). */
export function onPlotCursor(u: uPlot): void {
  if (cursorPinned.value || replaying.value) return;
  const idx = u.cursor.idx;
  const left = u.cursor.left ?? -1;
  cursorIdx.value = idx === undefined || idx === null || left < 0 ? null : idx;
}

/** Click on the plot toggles the pin. Returns a detach function. */
export function attachPinOnClick(u: uPlot): () => void {
  const over = u.over;
  const onClick = (e: MouseEvent) => {
    if (e.shiftKey) return;
    if (replaying.value) stopReplay();
    if (cursorPinned.value) {
      pinCursor(null);
      return;
    }
    const idx = u.cursor.idx;
    if (idx !== undefined && idx !== null) pinCursor(idx);
  };
  over.addEventListener('click', onClick);
  return () => over.removeEventListener('click', onClick);
}

/**
 * Moves every plot's cursor to sample `idx` without firing hooks or re-publishing to the sync
 * group. Plots already showing that sample (the hovered one and its synced peers) are left alone.
 */
export function pushCursor(
  plots: Iterable<uPlot>,
  idx: number | null,
  xs: ArrayLike<number>,
): void {
  for (const u of plots) {
    if (idx === null) {
      if ((u.cursor.left ?? -1) >= 0) u.setCursor({ left: -10, top: -10 }, false);
      continue;
    }
    const x = xs[idx];
    if (x === undefined) continue;
    if (u.cursor.idx === idx && (u.cursor.left ?? -1) >= 0) continue;
    const left = u.valToPos(x, 'x');
    const pr = globalThis.devicePixelRatio || 1;
    const top = u.bbox ? u.bbox.height / pr / 2 : 0;
    u.setCursor({ left, top }, false);
  }
}

/**
 * Keyboard on the stack: `←/→` step a pinned cursor (`Shift` ×10), pinning first if needed;
 * `Esc` unpins. Returns true when the key was handled.
 */
export function handleCursorKey(ev: KeyboardEvent, n: number): boolean {
  if (ev.altKey || ev.metaKey || ev.ctrlKey) return false;
  if (ev.key === 'Escape') {
    if (!cursorPinned.value) return false;
    pinCursor(null);
    return true;
  }
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return false;
  if (n <= 0) return false;
  if (!cursorPinned.value) pinCursor(cursorIdx.value ?? 0);
  const step = (ev.key === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 10 : 1);
  stepCursor(step, n);
  return true;
}
