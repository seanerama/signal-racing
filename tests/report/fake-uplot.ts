/**
 * A minimal uPlot stand-in for jsdom (which has no canvas). It records options and the calls the
 * report makes, so DOM tests can drive hooks and binds directly.
 */
import type uPlot from 'uplot';

export class FakeUPlot {
  static instances: FakeUPlot[] = [];
  static created = 0;

  opts: uPlot.Options;
  data: uPlot.AlignedData;
  root: HTMLElement;
  over: HTMLDivElement;
  cursor: { idx: number | null; left: number; top: number } = { idx: null, left: -10, top: -10 };
  select = { left: 0, top: 0, width: 0, height: 0 };
  bbox = { left: 0, top: 0, width: 600, height: 72 };
  scales: Record<string, { min?: number; max?: number }> = { x: {}, y: {} };
  width: number;
  height: number;
  setCursorCalls: Array<{ left: number; top: number }> = [];
  setScaleCalls: Array<{ min: number; max: number }> = [];
  destroyed = false;

  constructor(opts: uPlot.Options, data: uPlot.AlignedData, target: HTMLElement) {
    this.opts = opts;
    this.data = data;
    this.width = opts.width;
    this.height = opts.height;
    this.root = document.createElement('div');
    this.root.className = 'uplot';
    this.over = document.createElement('div');
    this.over.className = 'u-over';
    this.root.appendChild(this.over);
    target.appendChild(this.root);
    FakeUPlot.instances.push(this);
    FakeUPlot.created++;
  }

  /** x value → CSS px: identity, so tests can reason in data units. */
  valToPos(v: number): number {
    return v;
  }
  posToVal(p: number): number {
    return p;
  }
  /** Mirrors uPlot: the closest data index to `left` (identity scale). */
  setCursor(o: { left: number; top: number }, fire = true): void {
    this.setCursorCalls.push(o);
    this.cursor.left = o.left;
    this.cursor.top = o.top;
    const xs = this.data[0] as ArrayLike<number>;
    if (o.left < 0) {
      this.cursor.idx = null;
    } else {
      let best = 0;
      for (let i = 0; i < xs.length; i++) {
        if (Math.abs((xs[i] as number) - o.left) < Math.abs((xs[best] as number) - o.left))
          best = i;
      }
      this.cursor.idx = best;
    }
    if (fire) this.fire('setCursor');
  }
  setScale(key: string, lim: { min: number; max: number }): void {
    this.scales[key] = { ...lim };
    if (key === 'x') this.setScaleCalls.push(lim);
  }
  setSelect(o: { left: number; top: number; width: number; height: number }, fire = true): void {
    this.select = { ...o };
    if (fire) this.fire('setSelect');
  }
  setSize(o: { width: number; height: number }): void {
    this.width = o.width;
    this.height = o.height;
  }
  redraw(): void {}
  destroy(): void {
    this.destroyed = true;
    this.root.remove();
    FakeUPlot.instances = FakeUPlot.instances.filter((u) => u !== this);
  }

  /** Fires a hook by name (as uPlot would). */
  fire(name: keyof uPlot.Hooks.Defs): void {
    const hooks = (this.opts.hooks ?? {}) as Record<string, unknown>;
    const h = hooks[name];
    const list = (Array.isArray(h) ? h : h ? [h] : []) as Array<(u: unknown) => void>;
    for (const fn of list) fn(this);
  }

  /** Builds the wrapped listener for a bound mouse event and calls it. */
  bound(name: keyof uPlot.Cursor.Bind, ev: Partial<MouseEvent>, handler = () => null): unknown {
    const factory = this.opts.cursor?.bind?.[name];
    if (!factory) return handler();
    const listener = factory(this as unknown as uPlot, this.over, handler);
    return listener ? listener(ev as MouseEvent) : null;
  }

  static reset(): void {
    FakeUPlot.instances = [];
    FakeUPlot.created = 0;
  }
}
