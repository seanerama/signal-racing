import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelId } from '@/engine/types';
import { FakeUPlot } from './fake-uplot';

vi.mock('uplot', async () => ({ default: (await import('./fake-uplot')).FakeUPlot }));

const { StripStack } = await import('@/report/StripStack');
const { cursorIdx, cursorPinned, replaying, resetCursor, startReplay } =
  await import('@/report/cursor-store');
const { xZoom, resetZoom } = await import('@/report/zoom');
const { setProjector } = await import('@/report/projector');
const { beginDrag } = await import('@/report/dnd');
const { installFixtureChannelMeta, makeReportFixture } = await import('@/report/__fixtures__');

const SIX: ChannelId[] = [
  'speed',
  'long_g',
  'lat_g',
  'engine_rpm',
  'wheel_speed_rl',
  'rear_slip_ratio',
];

beforeAll(() => installFixtureChannelMeta());
beforeEach(() => {
  FakeUPlot.reset();
  resetCursor();
  resetZoom();
});
afterEach(() => {
  cleanup();
  setProjector(false);
});

function renderStack(over: Partial<Parameters<typeof StripStack>[0]> = {}) {
  const fx = makeReportFixture(200);
  const onStripsChange = vi.fn();
  const props = {
    current: fx.current,
    best: fx.best,
    strips: SIX,
    onStripsChange,
    availableIds: new Set(fx.ids),
    axis: 'time' as const,
    units: 'metric' as const,
    ...over,
  };
  const utils = render(<StripStack {...props} />);
  return { ...utils, onStripsChange, fx, props };
}

/** A DragEvent-ish init whose dataTransfer round-trips our payload. */
function dataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    effectAllowed: 'move',
    dropEffect: 'move',
  };
}

/** jsdom has no DragEvent: build one with `clientY` and our dataTransfer. */
function fireDrag(target: Element, type: 'dragover' | 'drop', dt: unknown, clientY = 0) {
  const ev = createEvent(type === 'dragover' ? 'dragOver' : 'drop', target, { dataTransfer: dt });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  fireEvent(target, ev);
}

function gutter(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-strip-gutter="${id}"]`);
  if (!el) throw new Error(`no gutter for ${id}`);
  return el;
}

describe('StripStack: uPlot instances', () => {
  it('with 200 channels available and 6 strips, creates exactly 6 uPlot instances', () => {
    renderStack();
    expect(FakeUPlot.instances).toHaveLength(6);
    expect(document.querySelectorAll('.uplot')).toHaveLength(6);
  });

  it('only the bottom strip shows the x-axis; series are [x, best, current]', () => {
    renderStack();
    const shown = FakeUPlot.instances.map((u) => Number(u.opts.axes?.[0]?.size ?? 0));
    expect(shown.filter((s) => s > 0)).toHaveLength(1);
    expect(shown[5]).toBeGreaterThan(0);
    const u = FakeUPlot.instances[0]!;
    expect(u.opts.series.map((s) => s.label)).toEqual([undefined, 'best', 'current']);
    expect(u.data).toHaveLength(3);
    // Dropouts become gaps (null), never NaN.
    const cur = u.data[2] as Array<number | null>;
    expect(cur.some((v) => v === null)).toBe(true);
    expect(cur.some((v) => typeof v === 'number' && Number.isNaN(v))).toBe(false);
  });

  it('a strip for an id not in availableIds renders the placeholder and no uPlot', () => {
    renderStack({ strips: [...SIX, 'clutch_temp'] });
    expect(screen.getByText('clutch_temp: not on this car')).toBeTruthy();
    expect(FakeUPlot.instances).toHaveLength(6);
  });

  it('rebuilds (not restyles) every strip when projector mode toggles', async () => {
    renderStack();
    const before = FakeUPlot.instances.slice();
    expect(before[0]!.opts.series[2]!.width).toBe(1.5);
    await act(async () => {
      setProjector(true);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(before.every((u) => u.destroyed)).toBe(true);
    expect(FakeUPlot.instances).toHaveLength(6);
    expect(FakeUPlot.instances[0]!.opts.series[2]!.width).toBe(2.5);
    expect(FakeUPlot.instances[0]!.opts.series[1]!.width).toBe(1.5);
  });
});

describe('StripStack: strip order operations', () => {
  it('remove: ✕ calls onStripsChange without the strip', () => {
    const { onStripsChange } = renderStack();
    fireEvent.click(screen.getByRole('button', { name: 'Remove lat_g' }));
    expect(onStripsChange).toHaveBeenLastCalledWith(SIX.filter((id) => id !== 'lat_g'));
  });

  it('remove: Delete on a focused gutter', () => {
    const { onStripsChange } = renderStack();
    fireEvent.keyDown(gutter('speed'), { key: 'Delete' });
    expect(onStripsChange).toHaveBeenLastCalledWith(SIX.slice(1));
  });

  it('reorder: ⌥↑/↓ moves the strip one place', () => {
    const { onStripsChange } = renderStack();
    fireEvent.keyDown(gutter('long_g'), { key: 'ArrowDown', altKey: true });
    expect(onStripsChange).toHaveBeenLastCalledWith([
      'speed',
      'lat_g',
      'long_g',
      'engine_rpm',
      'wheel_speed_rl',
      'rear_slip_ratio',
    ]);
    fireEvent.keyDown(gutter('long_g'), { key: 'ArrowUp', altKey: true });
    expect(onStripsChange).toHaveBeenLastCalledWith([
      'long_g',
      'speed',
      'lat_g',
      'engine_rpm',
      'wheel_speed_rl',
      'rear_slip_ratio',
    ]);
  });

  it('reorder: ⌥↑ on the top strip does nothing', () => {
    const { onStripsChange } = renderStack();
    fireEvent.keyDown(gutter('speed'), { key: 'ArrowUp', altKey: true });
    expect(onStripsChange).not.toHaveBeenCalled();
  });

  it('reorder: mouse drag a gutter onto the lower half of another strip', () => {
    const { onStripsChange } = renderStack();
    const dt = dataTransfer();
    fireEvent.dragStart(gutter('speed'), { dataTransfer: dt });
    const target = gutter('engine_rpm').closest('[role="listitem"]') as HTMLElement;
    target.getBoundingClientRect = () =>
      ({ top: 100, height: 72, bottom: 172, left: 0, right: 0, width: 0, x: 0, y: 100 }) as DOMRect;
    fireDrag(target, 'dragover', dt, 160);
    fireDrag(target, 'drop', dt, 160);
    expect(onStripsChange).toHaveBeenLastCalledWith([
      'long_g',
      'lat_g',
      'engine_rpm',
      'speed',
      'wheel_speed_rl',
      'rear_slip_ratio',
    ]);
  });

  it('add: dropping a channel-table row inserts it at the drop position', () => {
    const { onStripsChange } = renderStack();
    const dt = dataTransfer();
    const fake = new Event('dragstart') as DragEvent;
    Object.defineProperty(fake, 'dataTransfer', { value: dt });
    beginDrag(fake, { id: 'oil_temp', from: 'table' });
    const target = gutter('lat_g').closest('[role="listitem"]') as HTMLElement;
    target.getBoundingClientRect = () =>
      ({ top: 0, height: 72, bottom: 72, left: 0, right: 0, width: 0, x: 0, y: 0 }) as DOMRect;
    fireDrag(target, 'drop', dt, 10);
    expect(onStripsChange).toHaveBeenLastCalledWith([
      'speed',
      'long_g',
      'oil_temp',
      'lat_g',
      'engine_rpm',
      'wheel_speed_rl',
      'rear_slip_ratio',
    ]);
  });

  it('add: dropping onto the stack background appends', () => {
    const { onStripsChange } = renderStack();
    const dt = dataTransfer();
    dt.setData('application/x-signal-channel', JSON.stringify({ id: 'brake', from: 'table' }));
    fireEvent.drop(screen.getByTestId('strip-stack'), { dataTransfer: dt });
    expect(onStripsChange).toHaveBeenLastCalledWith([...SIX, 'brake']);
  });
});

describe('StripStack: shared cursor', () => {
  it('hover on one strip writes cursorIdx; every other strip follows', () => {
    renderStack();
    const [a, ...rest] = FakeUPlot.instances;
    void act(() => {
      a!.cursor.idx = 120;
      a!.cursor.left = 1.2;
      a!.fire('setCursor');
    });
    expect(cursorIdx.value).toBe(120);
    for (const u of rest) expect(u.cursor.idx).toBe(120);
  });

  it('click pins; arrows step one sample (shift: ten); Esc unpins', () => {
    renderStack();
    const u = FakeUPlot.instances[2]!;
    void act(() => {
      u.cursor.idx = 50;
      u.cursor.left = 0.5;
      u.fire('setCursor');
      u.over.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(cursorPinned.value).toBe(true);
    expect(document.querySelector('.strips--pinned')).toBeTruthy();
    // Hover is ignored while pinned.
    expect(u.bound('mousemove', { clientX: 1 })).toBeNull();
    const stack = screen.getByTestId('strip-stack');
    fireEvent.keyDown(stack, { key: 'ArrowRight' });
    expect(cursorIdx.value).toBe(51);
    fireEvent.keyDown(stack, { key: 'ArrowLeft', shiftKey: true });
    expect(cursorIdx.value).toBe(41);
    for (const p of FakeUPlot.instances) expect(p.cursor.idx).toBe(41);
    fireEvent.keyDown(stack, { key: 'Escape' });
    expect(cursorPinned.value).toBe(false);
  });

  it('a plain press never starts a drag selection; Shift does', () => {
    renderStack();
    const u = FakeUPlot.instances[0]!;
    const handler = vi.fn(() => null);
    u.bound('mousedown', { shiftKey: false }, handler);
    expect(handler).not.toHaveBeenCalled();
    u.bound('mousedown', { shiftKey: true }, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('pointer input on a strip stops Replay', () => {
    renderStack();
    void act(() => startReplay(100, 0.01, 1));
    expect(replaying.value).toBe(true);
    void act(() => {
      FakeUPlot.instances[3]!.bound('mousemove', { clientX: 3 });
    });
    expect(replaying.value).toBe(false);
  });
});

describe('StripStack: zoom', () => {
  it('shift-drag on one strip zooms all strips; double-click resets', () => {
    const { fx } = renderStack();
    const u = FakeUPlot.instances[1]!;
    void act(() => {
      u.select = { left: 2, top: 0, width: 3, height: 72 };
      u.fire('setSelect');
    });
    expect(xZoom.value).toMatchObject({ min: 2, max: 5 });
    for (const p of FakeUPlot.instances) expect(p.scales['x']).toEqual({ min: 2, max: 5 });
    void act(() => {
      u.bound('dblclick', {});
    });
    expect(xZoom.value).toBeNull();
    const end = fx.current.t[fx.current.n - 1]!;
    for (const p of FakeUPlot.instances) expect(p.scales['x']).toEqual({ min: 0, max: end });
  });
});

describe('StripStack: hint band and segments', () => {
  it('passes a hint band only to the named strip', () => {
    renderStack({ hintWindow: { channel: 'rear_slip_ratio', tStart: 0.3, tEnd: 1.1 } });
    // Each strip has two plugins: hint band and segment rules.
    expect(FakeUPlot.instances.every((u) => (u.opts.plugins ?? []).length === 2)).toBe(true);
  });
});
