import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
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
const { cursorIdx, replaying, resetCursor, startReplay, stopReplay } =
  await import('@/report/cursor-store');
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

  it('Replay sweeps the cursor in real time and stops at the end', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const fx = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Replay/ }));
    expect(replaying.value).toBe(true);
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    // ~1 s at 1× = ~100 samples at dt 0.01.
    expect(cursorIdx.value).toBeGreaterThanOrEqual(90);
    expect(cursorIdx.value).toBeLessThanOrEqual(101);
    void act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(cursorIdx.value).toBe(fx.current.n - 1);
    expect(replaying.value).toBe(false);
  });

  it('Shift+click replays at 4×; Esc stops', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Replay/ }), { shiftKey: true });
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cursorIdx.value).toBeGreaterThanOrEqual(380);
    void act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(replaying.value).toBe(false);
    const idx = cursorIdx.value;
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cursorIdx.value).toBe(idx);
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
