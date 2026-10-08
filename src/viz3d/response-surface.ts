/**
 * Response surface view (design-system "Response surface"; debrief only, it reveals the optimum).
 *
 * x, z = the two most influential unlocked levers (ticks at their discrete steps), y = outcome
 * time. Wireframe plus a 60%-opacity viridis face, unlit. Player runs are dots with run-number
 * labels joined in order by a thin `--text-dim` convergence path; the optimum is a `--best`
 * diamond. With one unlocked lever it draws the 2D curve in the same scene instead.
 *
 * Geometry comes from the pure `buildResponse`.
 */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { formatValue } from '@/units';
import { LEVER_SHORT } from '@/report/ResultHeader';
import { readVizColors, type VizColors } from './colors';
import { colorOf as sceneColor, createVizScene, srgbToLinear, type VizScene } from './scene';
import { buildResponse, type ResponseModel } from './surface-data';
import type { SurfaceProps, ViewHandle } from './types';

const GAP = 0.07;
const SURFACE_OPACITY = 0.6;

const colorOf = (css: string) => sceneColor(css).color;

function buildGroup(viz: VizScene, model: ResponseModel, colors: VizColors): Group {
  const g = new Group();
  const { w, h, d } = model.box;
  const surface = model.kind === 'surface';

  // ---- frame: floor grid at lever steps, back walls with y ticks ----
  const grid: number[] = [];
  const rule: number[] = [];
  if (surface) {
    for (const x of model.xSteps) grid.push(x, 0, 0, x, 0, d);
    for (const z of model.zSteps) grid.push(0, 0, z, w, 0, z);
    for (const t of model.yTicks) grid.push(0, t.pos, 0, w, t.pos, 0, 0, t.pos, 0, 0, t.pos, d);
    rule.push(
      0,
      0,
      0,
      w,
      0,
      0,
      w,
      0,
      0,
      w,
      0,
      d,
      w,
      0,
      d,
      0,
      0,
      d,
      0,
      0,
      d,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      h,
      0,
      0,
      0,
      d,
      0,
      h,
      d,
      w,
      0,
      0,
      w,
      h,
      0,
    );
  } else {
    for (const x of model.xSteps) grid.push(x, 0, 0, x, h, 0);
    for (const t of model.yTicks) grid.push(0, t.pos, 0, w, t.pos, 0);
    rule.push(0, 0, 0, w, 0, 0, 0, 0, 0, 0, h, 0);
  }
  g.add(viz.segments(grid, colors.grid));
  g.add(viz.segments(rule, colors.rule));

  // ---- labels ----
  for (const t of model.xTicks) {
    g.add(viz.label(t.label, new Vector3(t.pos, 0, d + GAP), 'viz3d__tick viz3d__tick--x'));
  }
  g.add(viz.label(model.xTitle, new Vector3(w / 2, 0, d + GAP * 6), 'viz3d__title'));
  for (const t of model.yTicks) {
    g.add(viz.label(t.label, new Vector3(-GAP, t.pos, d), 'viz3d__tick viz3d__tick--y'));
  }
  g.add(viz.label(model.yTitle, new Vector3(0, h + GAP * 1.6, d), 'viz3d__title'));
  if (model.kind === 'surface') {
    for (const t of model.zTicks) {
      g.add(viz.label(t.label, new Vector3(w + GAP, 0, t.pos), 'viz3d__tick viz3d__tick--z'));
    }
    g.add(viz.label(model.zTitle, new Vector3(w + GAP * 8, 0, d / 2), 'viz3d__title'));
  }

  // ---- the response itself ----
  if (model.kind === 'surface') {
    const { nx, nz } = model;
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(model.positions, 3));
    const linearColors = srgbToLinear(model.colors);
    geom.setAttribute('color', new Float32BufferAttribute(linearColors, 3));
    const idx: number[] = [];
    const wire: number[] = [];
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const a = k * nx + i;
        if (i < nx - 1 && k < nz - 1) idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
        if (i < nx - 1) wire.push(a, a + 1);
        if (k < nz - 1) wire.push(a, a + nx);
      }
    }
    geom.setIndex(idx);
    const face = new Mesh(
      geom,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: SURFACE_OPACITY,
        side: DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    face.renderOrder = 1;
    g.add(face);
    const wgeom = new BufferGeometry();
    wgeom.setAttribute('position', new Float32BufferAttribute(model.positions, 3));
    wgeom.setAttribute('color', new Float32BufferAttribute(linearColors, 3));
    wgeom.setIndex(wire);
    const wires = new LineSegments(wgeom, new LineBasicMaterial({ vertexColors: true }));
    wires.renderOrder = 2;
    g.add(wires);
  } else {
    const line = viz.line(model.positions, '#ffffff');
    const lg = line.geometry;
    lg.setColors(Array.from(srgbToLinear(model.colors)));
    line.material.vertexColors = true;
    line.material.needsUpdate = true;
    g.add(line);
  }

  // ---- player runs: dots, labels, drop lines, convergence path ----
  const dotGeom = new SphereGeometry(0.022, 14, 10);
  const dotMat = new MeshBasicMaterial({ color: colorOf(colors.text), depthTest: false });
  const drops: number[] = [];
  // Shared geometry/material: disposing a shared resource twice is a no-op in three.js.
  model.runs.forEach((r) => {
    const m = new Mesh(dotGeom, dotMat);
    m.position.set(r.x, r.y, r.z);
    m.renderOrder = 6;
    g.add(m);
    g.add(viz.label(String(r.index), new Vector3(r.x, r.y, r.z), 'viz3d__run', colors.text));
    if (surface) drops.push(r.x, 0, r.z, r.x, r.y, r.z);
  });
  if (model.runs.length === 0) {
    dotGeom.dispose();
    dotMat.dispose();
  }
  if (drops.length > 0) g.add(viz.segments(drops, colors.textFaint, 0.7));
  if (model.runs.length >= 2) {
    const path = viz.line(
      model.runs.flatMap((r) => [r.x, r.y, r.z]),
      colors.textDim,
      1,
    );
    path.material.depthTest = false;
    path.renderOrder = 5;
    g.add(path);
  }

  // ---- optimum: --best diamond ----
  const o = model.optimum;
  const diamond = new Mesh(
    new OctahedronGeometry(0.045),
    new MeshBasicMaterial({ color: colorOf(colors.best), depthTest: false }),
  );
  diamond.position.set(o.x, o.y, o.z);
  diamond.renderOrder = 7;
  g.add(diamond);
  if (surface) g.add(viz.segments([o.x, 0, o.z, o.x, o.y, o.z], colors.best, 0.6));
  g.add(viz.label('OPT', new Vector3(o.x, o.y, o.z), 'viz3d__opt', colors.best));

  viz.setContent(g);
  return g;
}

function legendHtml(model: ResponseModel, props: SurfaceProps, colors: VizColors): string {
  const u = props.units;
  const fmt = (t: number) => formatValue('time', u, t);
  const grad = [...colors.ramp].reverse().join(', ');
  const parts = [
    `<span class="viz3d__key"><span class="viz3d__bar" style="background:linear-gradient(90deg, ${grad})"></span>${fmt(model.colorRange[0])} … ${fmt(model.colorRange[1])}</span>`,
    `<span class="viz3d__key"><i class="viz3d__dot" style="background:${colors.text}"></i>runs, in order (${model.runs.length})</span>`,
    `<span class="viz3d__key"><i class="viz3d__diamond" style="background:${colors.best}"></i>optimum ${fmt(model.optimum.time)}</span>`,
  ];
  if (model.fixed.length > 0) {
    const f = model.fixed
      .map(
        (x) =>
          `${LEVER_SHORT[x.lever.id] ?? x.lever.id} ${formatValue(x.lever.quantity, u, x.value)}`,
      )
      .join(' · ');
    parts.push(`<span class="viz3d__key viz3d__note">held at optimum: ${f}</span>`);
  }
  if (model.interpolated > 0) {
    const total = model.kind === 'surface' ? model.nx * model.nz : model.positions.length / 3;
    parts.push(
      `<span class="viz3d__key viz3d__note" data-testid="viz3d-interp">${model.interpolated} of ${total} points interpolated from nearest evaluated</span>`,
    );
  }
  return parts.join('');
}

export function createResponseSurface(
  el: HTMLElement,
  initial: SurfaceProps,
): ViewHandle<SurfaceProps> {
  el.classList.add('viz3d');
  const colors = readVizColors();
  const viz = createVizScene(el, { background: colors.bg });
  const legend = document.createElement('div');
  legend.className = 'viz3d__legend micro';
  legend.setAttribute('data-testid', 'viz3d-legend');
  el.appendChild(legend);
  let props = initial;
  let fitKey = '';

  const render = () => {
    const { grid, level, runs, units } = props;
    const model = buildResponse({
      levers: level.levers,
      samples: grid.samples,
      optimum: { setup: grid.optimum.setup, totalTime: grid.optimum.outcome.totalTime },
      runs,
      units,
      ramp: colors.ramp,
    });
    buildGroup(viz, model, colors);
    legend.innerHTML = legendHtml(model, props, colors);
    el.dataset.kind = model.kind;
    el.dataset.levers = model.levers.map((l) => l.id).join(',');
    const key = `${model.kind}:${model.levers.map((l) => l.id).join(',')}`;
    if (key !== fitKey) {
      fitKey = key;
      const { w, h, d } = model.box;
      if (model.kind === 'surface') {
        viz.fit(
          new Vector3(w / 2, h / 2, d / 2),
          Math.hypot(w + 0.5, h + 0.3, d + 0.5) / 2,
          new Vector3(1.05, 0.85, 1.25),
        );
      } else {
        viz.fit(
          new Vector3(w / 2, h / 2, 0),
          Math.hypot(w + 0.6, h + 0.5) / 2,
          new Vector3(0.12, 0.12, 1),
          0.6,
        );
      }
    }
  };
  render();

  return {
    ready: Promise.resolve(),
    update(next) {
      props = next;
      render();
    },
    dispose() {
      viz.dispose();
      legend.remove();
    },
  };
}
