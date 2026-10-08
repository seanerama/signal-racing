import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TrackDraw from '@/report/track-draw';
import type { Scene } from '@/report/track-draw';

const draws: Scene[] = [];
vi.mock('@/report/track-draw', async (orig) => {
  const real = await orig<typeof TrackDraw>();
  return {
    ...real,
    drawScene: vi.fn((_ctx: CanvasRenderingContext2D, scene: Scene) => {
      draws.push(scene);
    }),
  };
});

const { TrackView, alignedBestIndex } = await import('@/report/TrackView');
const { cursorIdx, resetCursor, startReplay, stopReplay } = await import('@/report/cursor-store');
const { playState, resetPlayback, startPlayback } = await import('@/report/playback');
const { deltaClass } = await import('@/report/track-draw');
const { installFixtureChannelMeta, makeReportFixture } = await import('@/report/__fixtures__');

beforeAll(() => {
  installFixtureChannelMeta();
  // jsdom has no canvas: any non-null context will do, drawScene is mocked.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({}) as unknown as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement['getContext'];
});
beforeEach(() => {
  draws.length = 0;
  resetCursor();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  stopReplay();
});

function renderView(over: Record<string, unknown> = {}) {
  const fx = makeReportFixture(12);
  render(
    <TrackView
      geometry={fx.track}
      current={fx.current}
      best={fx.best}
      colorBy={null}
      segmentLabels={fx.segmentLabels}
      units="metric"
      axis="time"
      {...over}
    />,
  );
  return fx;
}

describe('TrackView', () => {
  it('parks the block at the start with no cursor', () => {
    renderView();
    const last = draws.at(-1)!;
    expect(last.current.x).toBeCloseTo(0, 3);
    expect(last.current.y).toBeCloseTo(0, 3);
    expect(last.best).not.toBeNull();
  });

  it('setting cursorIdx triggers exactly one redraw, at that sample', () => {
    const fx = renderView();
    const before = draws.length;
    void act(() => {
      cursorIdx.value = 700;
    });
    expect(draws.length).toBe(before + 1);
    const pose = draws.at(-1)!.current;
    expect(pose.x).toBeCloseTo(fx.current.getClean('pos_x')[700]!, 4);
    expect(pose.heading).toBeCloseTo(fx.current.getClean('heading')[700]!, 4);
    // No idle loop: nothing else draws.
    expect(draws.length).toBe(before + 1);
  });

  it('the best block is aligned by time or by distance', () => {
    const fx = makeReportFixture(12);
    const i = 600;
    const jt = alignedBestIndex(fx.current, fx.best, i, 'time');
    const js = alignedBestIndex(fx.current, fx.best, i, 'distance');
    expect(fx.best.t[jt]).toBeCloseTo(fx.current.t[i]!, 2);
    expect(Math.abs(fx.best.s[js]! - fx.current.s[i]!)).toBeLessThan(1);
    // The best run is faster, so at the same time it is further along.
    expect(fx.best.s[jt]!).toBeGreaterThan(fx.current.s[i]!);
  });

  it('colour-by passes normalised path values and shows a min/max legend', () => {
    renderView({ colorBy: 'lat_g' });
    const scene = draws.at(-1)!;
    expect(scene.pathValues).not.toBeNull();
    const legend = screen.getByTestId('trackview-legend');
    expect(legend.textContent).toContain('lat_g');
    expect(legend.textContent).toContain('g');
  });

  it('playback (Stage 10) drives the car and draws the racing line only up to it', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const fx = renderView();
    void act(() => {
      startPlayback({ runIndex: 1, n: fx.current.n, dt: fx.current.dt, gating: true });
    });
    expect(playState.value).toBe('playing');
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    // ~1 s at 1× = ~100 samples at dt 0.01.
    const idx = cursorIdx.value!;
    expect(idx).toBeGreaterThanOrEqual(90);
    expect(idx).toBeLessThanOrEqual(101);
    const mid = draws.at(-1)!;
    expect(mid.lineUpTo).toBeCloseTo(fx.current.s[idx]!, 3);
    expect(mid.current.x).toBeCloseTo(fx.current.getClean('pos_x')[idx]!, 4);
    void act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(playState.value).toBe('idle');
    expect(draws.at(-1)!.lineUpTo).toBeNull();
    resetPlayback();
  });

  it('the racing line is coloured by speed against the best run (lime faster, orange slower)', () => {
    const fx = renderView();
    const scene = draws.at(-1)!;
    expect(scene.lineDelta).not.toBeNull();
    // The fixture's best run is faster, so most metres read slower (negative delta).
    const d = Array.from(scene.lineDelta!).filter((v) => Number.isFinite(v));
    expect(d.length).toBeGreaterThan(10);
    expect(d.filter((v) => deltaClass(v) < 0).length).toBeGreaterThan(0);
    expect(deltaClass(0.6)).toBe(1);
    expect(deltaClass(-0.6)).toBe(-1);
    expect(deltaClass(0.2)).toBe(0);
    expect(deltaClass(NaN)).toBe(0);
    expect(fx.best).toBeTruthy();
    expect(screen.getByTestId('trackview-key').textContent).toContain('faster');
  });
});

describe('cursor-store', () => {
  it('startReplay restarts from sample 0', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    cursorIdx.value = 500;
    startReplay(1000, 0.01, 1);
    expect(cursorIdx.value).toBe(0);
    stopReplay();
  });
});
