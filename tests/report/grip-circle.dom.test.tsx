/** GripCircle (Stage 9): one redraw per cursor change, clean data, best aligned, no idle loop. */
import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Draw from '@/report/grip-circle-draw';
import type { GripScene } from '@/report/grip-circle-draw';
import type { RunTelemetry } from '@/telemetry/types';

const draws: GripScene[] = [];
vi.mock('@/report/grip-circle-draw', async (orig) => {
  const real = await orig<typeof Draw>();
  return {
    ...real,
    drawGripCircle: vi.fn((_ctx: CanvasRenderingContext2D, scene: GripScene) => {
      draws.push(scene);
    }),
  };
});

const { GripCircle } = await import('@/report/GripCircle');
const { cursorIdx, resetCursor } = await import('@/report/cursor-store');

/** A run whose clean forces are known and whose noisy `get()` would be wrong (never read). */
function stubRun(n: number, scale = 1): RunTelemetry {
  const t = new Float32Array(n).map((_, i) => i * 0.01);
  const s = new Float32Array(n).map((_, i) => i * 0.5);
  const clean: Record<string, Float32Array> = {
    fx_front: new Float32Array(n).fill(-2000 * scale),
    fy_front: new Float32Array(n).map((_, i) => i * 10 * scale),
    grip_budget_front: new Float32Array(n).fill(10000),
    fx_rear: new Float32Array(n).fill(3000 * scale),
    fy_rear: new Float32Array(n).fill(4000 * scale),
    grip_budget_rear: new Float32Array(n).fill(10000),
  };
  return {
    n,
    dt: 0.01,
    t,
    s,
    seg: new Uint8Array(n),
    channelIds: Object.keys(clean),
    get: () => new Float32Array(n).fill(1e9),
    getClean: (id) => clean[id]!,
  };
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({}) as unknown as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement['getContext'];
});
beforeEach(() => {
  draws.length = 0;
  resetCursor();
});
afterEach(() => cleanup());

describe('GripCircle', () => {
  it('draws once on mount and once per cursorIdx change, from clean forces', () => {
    const cur = stubRun(300);
    render(<GripCircle current={cur} best={stubRun(300, 2)} axis="time" units="metric" />);
    const mounted = draws.length;
    expect(mounted).toBeGreaterThanOrEqual(1);
    void act(() => {
      cursorIdx.value = 200;
    });
    expect(draws.length).toBe(mounted + 1);
    const sc = draws.at(-1)!;
    expect(sc.axles.front.current!.x).toBeCloseTo(-0.2, 6);
    expect(sc.axles.front.current!.y).toBeCloseTo(0.2, 6);
    expect(sc.axles.rear.current).toEqual({ x: 0.3, y: 0.4 });
    // 0.5 s trail at 100 Hz: the 50 samples before the cursor.
    expect(sc.axles.rear.trail).toHaveLength(50);
    // Best at the same t, hollow: here twice the forces.
    expect(sc.axles.rear.best!.x).toBeCloseTo(0.6, 6);
    void act(() => {
      cursorIdx.value = 201;
    });
    expect(draws.length).toBe(mounted + 2);
    expect(screen.getByTestId('grip-circle').getAttribute('aria-label')).toContain(
      'model estimate',
    );
  });

  it('with no run it draws empty circles and says so', () => {
    render(<GripCircle current={null} best={null} axis="time" units="metric" />);
    expect(draws.at(-1)!.axles.front.current).toBeNull();
    expect(screen.getByText('no run')).toBeTruthy();
  });
});
