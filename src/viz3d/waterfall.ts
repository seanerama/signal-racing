/**
 * Run waterfall view (design-system "Run waterfall"): one channel across all runs.
 * x = time/distance, y = value (display units), z = run index (oldest at the back).
 *
 * Geometry comes from the pure `buildWaterfall`; this module only turns it into three.js objects,
 * labels and hover. Hovering a ribbon highlights it and shows `RUN n · setup chips`.
 */
import { Group, Vector3 } from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { formatValue } from '@/units';
import { channelMeta } from '@/report/channel-meta';
import { setupChipText } from './axes';
import { readVizColors, slotHue, type VizColors } from './colors';
import { createVizScene, LINE_W, LINE_W_HOVER, type VizScene } from './scene';
import type { ViewHandle, WaterfallProps } from './types';
import { buildWaterfall, type Ribbon, type WaterfallModel } from './waterfall-data';

const HOVER_PX = 10;
/** Points per ribbon used for hover hit-testing. */
const HIT_POINTS = 160;
const LABEL_GAP = 0.06;

interface Built {
  model: WaterfallModel;
  lines: Map<number, Line2[]>;
  hits: Array<{ ribbon: Ribbon; pts: Vector3[] }>;
}

function buildGroup(viz: VizScene, model: WaterfallModel, colors: VizColors): Built {
  const g = new Group();
  const { w, h, d } = model.box;
  const zBack = -d - 0.08;
  const zFront = 0.08;

  // Floor grid: x ticks across the depth, one line under each run; box edges in --rule.
  const grid: number[] = [];
  for (const t of model.xTicks) grid.push(t.pos, 0, zBack, t.pos, 0, zFront);
  for (const t of model.zTicks) grid.push(0, 0, t.pos, w, 0, t.pos);
  // Back wall: y ticks and the x ticks rising behind the oldest run.
  for (const t of model.yTicks) grid.push(0, t.pos, zBack, w, t.pos, zBack);
  for (const t of model.xTicks) grid.push(t.pos, 0, zBack, t.pos, h, zBack);
  g.add(viz.segments(grid, colors.grid));
  const rule = [
    // floor outline
    0,
    0,
    zBack,
    w,
    0,
    zBack,
    w,
    0,
    zBack,
    w,
    0,
    zFront,
    w,
    0,
    zFront,
    0,
    0,
    zFront,
    0,
    0,
    zFront,
    0,
    0,
    zBack,
    // y axis (back-left)
    0,
    0,
    zBack,
    0,
    h,
    zBack,
  ];
  g.add(viz.segments(rule, colors.rule));

  // Labels.
  for (const t of model.xTicks) {
    g.add(
      viz.label(t.label, new Vector3(t.pos, 0, zFront + LABEL_GAP), 'viz3d__tick viz3d__tick--x'),
    );
  }
  for (const t of model.yTicks) {
    g.add(viz.label(t.label, new Vector3(-LABEL_GAP, t.pos, zBack), 'viz3d__tick viz3d__tick--y'));
  }
  for (const t of model.zTicks) {
    g.add(viz.label(t.label, new Vector3(w + LABEL_GAP, 0, t.pos), 'viz3d__tick viz3d__tick--z'));
  }
  g.add(viz.label(model.xTitle, new Vector3(w / 2, 0, zFront + LABEL_GAP * 6), 'viz3d__title'));
  g.add(viz.label(model.yTitle, new Vector3(0, h + LABEL_GAP * 1.5, zBack), 'viz3d__title'));

  // Ribbons: history first (underneath), then best, then current.
  const order = { history: 0, best: 1, current: 2 } as const;
  const lines = new Map<number, Line2[]>();
  const hits: Built['hits'] = [];
  for (const r of [...model.ribbons].sort((a, b) => order[a.role] - order[b.role])) {
    const ls = r.pieces.map((p) => {
      const l = viz.line(p, r.color, LINE_W);
      l.renderOrder = order[r.role];
      l.userData.order = order[r.role];
      g.add(l);
      return l;
    });
    lines.set(r.runIndex, ls);
    const pts: Vector3[] = [];
    for (const p of r.pieces) {
      const n = p.length / 3;
      const k = Math.max(1, Math.floor(n / (HIT_POINTS / r.pieces.length)));
      for (let i = 0; i < n; i += k) pts.push(new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    }
    hits.push({ ribbon: r, pts });
  }
  viz.setContent(g);
  return { model, lines, hits };
}

function legendHtml(model: WaterfallModel, props: WaterfallProps, colors: VizColors): string {
  const cur = model.currentIndex;
  const best = model.bestIndex;
  const curColor = slotHue(props.slot);
  const parts: string[] = [];
  if (cur !== null) {
    parts.push(
      `<span class="viz3d__key"><i style="background:${curColor}"></i>current · RUN ${cur}${cur === best ? ' · best' : ''}</span>`,
    );
  }
  if (best !== null && best !== cur) {
    parts.push(
      `<span class="viz3d__key"><i style="background:${colors.best}"></i>best · RUN ${best}</span>`,
    );
  }
  const older = model.ribbons.filter((r) => r.role === 'history').length;
  if (older > 0) {
    parts.push(
      `<span class="viz3d__key"><i class="viz3d__ramp"></i>older · ${older} run${older === 1 ? '' : 's'}, by age</span>`,
    );
  }
  return parts.join('');
}

export function createWaterfall(
  el: HTMLElement,
  initial: WaterfallProps,
): ViewHandle<WaterfallProps> {
  el.classList.add('viz3d');
  const colors = readVizColors();
  const viz = createVizScene(el, { background: colors.bg });
  const legend = document.createElement('div');
  legend.className = 'viz3d__legend micro';
  legend.setAttribute('data-testid', 'viz3d-legend');
  el.appendChild(legend);
  const tip = document.createElement('div');
  tip.className = 'viz3d__tip data';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  el.appendChild(tip);

  let props = initial;
  let built: Built | null = null;
  let hovered: number | null = null;
  let boxKey = '';

  const setHover = (idx: number | null, at?: { x: number; y: number }) => {
    if (!built) return;
    if (idx !== hovered) {
      hovered = idx;
      for (const [runIndex, ls] of built.lines) {
        for (const l of ls) {
          const m = l.material;
          const on = idx === null || runIndex === idx;
          m.linewidth = runIndex === idx ? LINE_W_HOVER : LINE_W;
          m.opacity = on ? 1 : 0.3;
          m.transparent = !on;
          m.depthWrite = on;
          l.renderOrder = runIndex === idx ? 10 : (l.userData.order as number);
        }
      }
      viz.requestRender();
    }
    if (idx === null) {
      tip.hidden = true;
      return;
    }
    const run = props.runs.find((r) => r.index === idx);
    if (!run) return;
    const chips = setupChipText(run.setup, props.levers ?? [], props.units);
    const time = run.outcome.finished
      ? formatValue('time', props.units, run.outcome.totalTime)
      : 'DNF';
    tip.textContent = `RUN ${idx}${chips ? ` · ${chips}` : ''} · ${time}`;
    tip.hidden = false;
    if (at) {
      const { width } = viz.size();
      tip.style.left = `${Math.min(at.x + 12, width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${Math.max(4, at.y - 28)}px`;
    }
  };

  const onMove = (ev: PointerEvent) => {
    if (!built || ev.buttons !== 0) return;
    const rect = viz.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    let bestD = HOVER_PX * HOVER_PX;
    let found: number | null = null;
    for (const { ribbon, pts } of built.hits) {
      for (let i = 0; i < pts.length; i++) {
        const s = viz.toScreen(pts[i] as Vector3);
        let dd = (s.x - px) ** 2 + (s.y - py) ** 2;
        // Distance to the segment to the next point, for sparse hit points.
        const nxt = pts[i + 1];
        if (nxt) {
          const e = viz.toScreen(nxt);
          const vx = e.x - s.x;
          const vy = e.y - s.y;
          const len = vx * vx + vy * vy;
          if (len > 0) {
            const t = Math.max(0, Math.min(1, ((px - s.x) * vx + (py - s.y) * vy) / len));
            dd = Math.min(dd, (s.x + t * vx - px) ** 2 + (s.y + t * vy - py) ** 2);
          }
        }
        if (dd < bestD) {
          bestD = dd;
          found = ribbon.runIndex;
        }
      }
    }
    setHover(found, { x: px, y: py });
  };
  const onLeave = () => setHover(null);
  viz.canvas.addEventListener('pointermove', onMove);
  viz.canvas.addEventListener('pointerleave', onLeave);

  const render = () => {
    const meta = channelMeta(props.channel);
    const model = buildWaterfall({
      runs: props.runs,
      channel: props.channel,
      quantity: meta.quantity,
      units: props.units,
      axis: props.axis,
      currentColor: slotHue(props.slot),
      bestColor: colors.best,
      ramp: colors.ramp,
      ...(props.bestIndex !== undefined ? { bestIndex: props.bestIndex } : {}),
    });
    hovered = null;
    tip.hidden = true;
    built = buildGroup(viz, model, colors);
    legend.innerHTML = legendHtml(model, props, colors);
    const { w, h, d } = model.box;
    const key = `${w}:${h}:${d}`;
    if (key !== boxKey) {
      boxKey = key;
      const center = new Vector3(w / 2, h / 2, -d / 2);
      const radius = Math.hypot(w + 0.5, h + 0.2, d + 0.3) / 2;
      viz.fit(center, radius, new Vector3(0.42, 0.5, 1), 0.7);
    }
    el.dataset.ribbons = String(model.ribbons.length);
  };
  render();

  return {
    ready: Promise.resolve(),
    update(next) {
      props = next;
      render();
    },
    dispose() {
      viz.canvas.removeEventListener('pointermove', onMove);
      viz.canvas.removeEventListener('pointerleave', onLeave);
      viz.dispose();
      legend.remove();
      tip.remove();
      built = null;
    },
  };
}
