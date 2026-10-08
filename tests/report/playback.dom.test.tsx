/**
 * Real-time run playback (Stage 10): the playhead advances in real time at 1×/2×/4×, pauses and
 * resumes, Skip finishes instantly, the shared cursor follows the playhead, and a first playback
 * gates the run's results until it ends. The current trace's path is cut at the playhead.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cursorIdx, resetCursor } from '@/report/cursor-store';
import {
  frameStats,
  isGated,
  pausePlayback,
  playhead,
  playing,
  playSpeed,
  playState,
  resetFrameStats,
  resetPlayback,
  resumePlayback,
  setPlaySpeed,
  skipPlayback,
  startPlayback,
} from '@/report/playback';
import { PlaybackControls } from '@/report/PlaybackControls';
import { progressivePaths } from '@/report/uplot-theme';

const N = 2000; // 20 s at 100 Hz
const DT = 0.01;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  resetPlayback();
  resetCursor();
  setPlaySpeed(1);
  resetFrameStats();
});
afterEach(() => {
  cleanup();
  resetPlayback();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('playback store', () => {
  it('plays at 1× in real time; the cursor follows the playhead; the end reveals everything', async () => {
    startPlayback({ runIndex: 3, n: N, dt: DT, gating: true });
    expect(playState.value).toBe('playing');
    expect(playhead.value).toBe(0);
    expect(isGated(3)).toBe(true);
    expect(isGated(2)).toBe(false);
    void advance(1000);
    expect(playhead.value!).toBeGreaterThanOrEqual(95);
    expect(playhead.value!).toBeLessThanOrEqual(101);
    expect(cursorIdx.value).toBe(playhead.value);
    void advance(30_000);
    expect(playState.value).toBe('idle');
    expect(playhead.value).toBeNull();
    expect(playing.value).toBeNull();
    expect(isGated(3)).toBe(false);
    expect(cursorIdx.value).toBe(N - 1);
    await Promise.resolve();
    expect(frameStats().frames).toBeGreaterThan(10);
  });

  it('2× and 4× scale the rate, and the speed can change mid-play', () => {
    setPlaySpeed(4);
    startPlayback({ runIndex: 1, n: N, dt: DT, gating: false });
    void advance(1000);
    expect(playhead.value!).toBeGreaterThanOrEqual(380);
    expect(playhead.value!).toBeLessThanOrEqual(401);
    const at = playhead.value!;
    setPlaySpeed(2);
    void advance(1000);
    expect(playhead.value! - at).toBeGreaterThanOrEqual(185);
    expect(playhead.value! - at).toBeLessThanOrEqual(205);
    expect(playSpeed.value).toBe(2);
  });

  it('pause holds the playhead; resume continues from it; skip finishes instantly', () => {
    startPlayback({ runIndex: 1, n: N, dt: DT, gating: true });
    void advance(500);
    pausePlayback();
    const held = playhead.value!;
    expect(playState.value).toBe('paused');
    void advance(2000);
    expect(playhead.value).toBe(held);
    resumePlayback();
    void advance(500);
    expect(playhead.value!).toBeGreaterThan(held);
    expect(playhead.value!).toBeLessThan(held + 60);
    skipPlayback();
    expect(playState.value).toBe('idle');
    expect(playhead.value).toBeNull();
    expect(isGated(1)).toBe(false);
  });
});

describe('PlaybackControls', () => {
  it('Pause/Skip while playing, Replay when idle, and a speed group', () => {
    const onReplay = vi.fn();
    const onSpeed = vi.fn();
    render(<PlaybackControls canReplay onReplay={onReplay} onSpeed={onSpeed} />);
    fireEvent.click(screen.getByTestId('pb-replay'));
    expect(onReplay).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('pb-speed-4'));
    expect(onSpeed).toHaveBeenCalledWith(4);
    void act(() => startPlayback({ runIndex: 1, n: N, dt: DT, gating: true }));
    expect(screen.getByTestId('pb-pause').textContent).toContain('Pause');
    fireEvent.click(screen.getByTestId('pb-pause'));
    expect(playState.value).toBe('paused');
    expect(screen.getByTestId('pb-pause').textContent).toContain('Resume');
    fireEvent.click(screen.getByTestId('pb-skip'));
    expect(playState.value).toBe('idle');
    expect(screen.getByTestId('pb-replay')).toBeTruthy();
    expect(screen.getByTestId('pb-speed-1').getAttribute('aria-checked')).toBe('true');
  });
});

describe('progressivePaths', () => {
  it('cuts the index range at the playhead without copying data', () => {
    const calls: Array<[number, number]> = [];
    const base = ((_u: unknown, _s: number, i0: number, i1: number) => {
      calls.push([i0, i1]);
      return null;
    }) as unknown as Parameters<typeof progressivePaths>[0];
    let lim = 120;
    const p = progressivePaths(base, () => lim);
    p(null as never, 2, 0, 999);
    lim = Infinity;
    p(null as never, 2, 0, 999);
    lim = -5;
    p(null as never, 2, 10, 999);
    expect(calls).toEqual([
      [0, 120],
      [0, 999],
      [10, 10],
    ]);
  });
});
