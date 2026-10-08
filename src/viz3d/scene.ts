/**
 * Shared three.js setup for the 3D data views (design-system "Three.js data views").
 *
 * - Perspective camera, FOV 30° (reads almost orthographic, like an engineering plot).
 * - OrbitControls with damping that moves only on user input: frames are rendered on demand, and
 *   the loop runs only while the pointer is down or damping is settling. No idle rotation.
 *   With `prefers-reduced-motion: reduce`, damping is off.
 * - CSS2DRenderer for axis labels (mono micro, `--text-dim`, with units).
 * - No lights, no shadows, no post-processing: every material is unlit.
 * - `dispose()` frees every geometry and material in the scene, the renderer, and the WebGL
 *   context itself (so repeated open/close never trips the browser's context limit).
 */
import type { Group, Vector3 } from 'three';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  type Material,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { parseColor } from './colors';

export const FOV = 30;
/** Screen-space line width of data lines (design-system: 1.5px). */
export const LINE_W = 1.5;
export const LINE_W_HOVER = 2.5;
/** < 1 frames tighter than the bounding sphere (plot boxes are flat, the sphere is loose). */
const FIT_TIGHT = 0.78;

export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export interface VizScene {
  readonly el: HTMLElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  /** Replaces the plotted content (the old group is disposed). */
  setContent(group: Group): void;
  /** Frames a box centred on `center` with bounding radius `radius`, seen from `dir`. */
  fit(center: Vector3, radius: number, dir: Vector3, tight?: number): void;
  /** Schedules one frame. */
  requestRender(): void;
  /** Called after every frame (e.g. to place a tooltip). */
  onFrame(fn: () => void): void;
  /** A screen-space line (Line2) whose resolution tracks the canvas size. */
  line(points: ArrayLike<number>, color: string, width?: number, opacity?: number): Line2;
  /** 1px segments (grid lines). `points` are xyz pairs. */
  segments(points: number[], color: string, opacity?: number): LineSegments;
  /** A CSS2D label at `pos`. */
  label(text: string, pos: Vector3, cls: string, color?: string): CSS2DObject;
  /** Projects a world point to CSS px within the canvas. */
  toScreen(p: Vector3): { x: number; y: number };
  size(): { width: number; height: number };
  dispose(): void;
}

/**
 * Frees every geometry and material under `root` and removes CSS2D label elements (a
 * CSS2DObject only removes its own element when *it* is removed, not when an ancestor is).
 */
function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
    const obj = o as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    obj.geometry?.dispose();
    const m = obj.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}

/** A token colour (sRGB) as a three.js colour in the linear working space, plus its alpha. */
export function colorOf(css: string): { color: Color; alpha: number } {
  const c = parseColor(css);
  return { color: new Color().setRGB(c.r, c.g, c.b, SRGBColorSpace), alpha: c.a };
}

/** sRGB triples (0–1) → linear working-space triples, for vertex colour attributes. */
export function srgbToLinear(rgb: ArrayLike<number>): Float32Array {
  const out = new Float32Array(rgb.length);
  const c = new Color();
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    c.setRGB(rgb[i] as number, rgb[i + 1] as number, rgb[i + 2] as number, SRGBColorSpace);
    out[i] = c.r;
    out[i + 1] = c.g;
    out[i + 2] = c.b;
  }
  return out;
}

export function createVizScene(
  el: HTMLElement,
  opts: { reducedMotion?: boolean; background: string },
): VizScene {
  const reduced = opts.reducedMotion ?? prefersReducedMotion();
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.setClearColor(colorOf(opts.background).color, 1);
  const canvas = renderer.domElement;
  canvas.classList.add('viz3d__canvas');
  el.appendChild(canvas);

  const labels = new CSS2DRenderer();
  labels.domElement.classList.add('viz3d__labels');
  el.appendChild(labels.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.12;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.autoRotate = false;
  controls.rotateSpeed = 0.6;
  // Exposed for tests and devtools: reduced motion turns damping off.
  el.dataset.damping = String(controls.enableDamping);

  let content: Group | null = null;
  const lineMats = new Set<LineMaterial>();
  const frameHooks: Array<() => void> = [];
  const resolution = new Vector2(1, 1);
  let raf = 0;
  let interacting = false;
  let looping = false;
  let disposed = false;

  const size = () => ({
    width: Math.max(1, el.clientWidth),
    height: Math.max(1, el.clientHeight),
  });

  const draw = () => {
    renderer.render(scene, camera);
    labels.render(scene, camera);
    for (const fn of frameHooks) fn();
  };

  const requestRender = () => {
    if (disposed || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  };

  // Damping loop: runs while the pointer is down and until the camera settles.
  const loop = () => {
    if (disposed) return;
    const moved = controls.update();
    draw();
    if (interacting || moved) requestAnimationFrame(loop);
    else looping = false;
  };
  const onStart = () => {
    interacting = true;
    if (!looping && controls.enableDamping) {
      looping = true;
      requestAnimationFrame(loop);
    }
  };
  const onEnd = () => {
    interacting = false;
  };
  const onChange = () => {
    if (!looping) requestRender();
  };
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);
  controls.addEventListener('change', onChange);

  const resize = () => {
    const { width, height } = size();
    renderer.setSize(width, height, true);
    labels.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    resolution.set(width, height);
    for (const m of lineMats) m.resolution.copy(resolution);
    requestRender();
  };
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(el);

  const viz: VizScene = {
    el,
    renderer,
    scene,
    camera,
    controls,
    canvas,
    setContent(group) {
      if (content) {
        scene.remove(content);
        disposeTree(content);
      }
      // Line materials not in the new group are dead.
      const live = new Set<LineMaterial>();
      group.traverse((o) => {
        const m = (o as Object3D & { material?: unknown }).material;
        if (m instanceof LineMaterial) live.add(m);
      });
      lineMats.clear();
      for (const m of live) {
        m.resolution.copy(resolution);
        lineMats.add(m);
      }
      content = group;
      scene.add(group);
      requestRender();
    },
    fit(center, radius, dir, tight = FIT_TIGHT) {
      // Fit the bounding sphere to the narrower of the two half-FOVs. The sphere over-bounds a
      // flat plot box, so pull in a little (`FIT_TIGHT`).
      const vHalf = ((FOV / 2) * Math.PI) / 180;
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
      const dist = (radius / Math.sin(Math.min(vHalf, hHalf))) * tight;
      const d = dir.clone().normalize().multiplyScalar(dist);
      camera.position.copy(center).add(d);
      camera.near = Math.max(0.01, dist / 50);
      camera.far = dist * 10;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = dist * 0.3;
      controls.maxDistance = dist * 3;
      controls.update();
      requestRender();
    },
    requestRender,
    onFrame(fn) {
      frameHooks.push(fn);
    },
    line(points, color, width = LINE_W, opacity = 1) {
      const g = new LineGeometry();
      g.setPositions(Array.from(points));
      const c = colorOf(color);
      const mat = new LineMaterial({
        color: c.color,
        linewidth: width,
        worldUnits: false,
        transparent: opacity * c.alpha < 1,
        opacity: opacity * c.alpha,
        depthWrite: opacity * c.alpha >= 1,
      });
      mat.resolution.copy(resolution);
      lineMats.add(mat);
      const l = new Line2(g, mat);
      l.computeLineDistances();
      return l;
    },
    segments(points, color, opacity = 1) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(points, 3));
      const c = colorOf(color);
      const a = opacity * c.alpha;
      const mat = new LineBasicMaterial({
        color: c.color,
        transparent: a < 1,
        opacity: a,
        depthWrite: a >= 1,
      });
      return new LineSegments(g, mat);
    },
    label(text, pos, cls, color) {
      const div = document.createElement('div');
      div.className = `viz3d__label ${cls}`;
      div.textContent = text;
      if (color) div.style.color = color;
      const obj = new CSS2DObject(div);
      obj.position.copy(pos);
      return obj;
    },
    toScreen(p) {
      const { width, height } = size();
      const v = p.clone().project(camera);
      return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
    },
    size,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.removeEventListener('change', onChange);
      controls.dispose();
      if (content) {
        scene.remove(content);
        disposeTree(content);
        content = null;
      }
      lineMats.clear();
      frameHooks.length = 0;
      renderer.dispose();
      // Release the context now rather than waiting for GC, so open/close cycles never hit the
      // browser's live-context cap. (dispose() already removed the context-lost listener.)
      renderer.forceContextLoss();
      canvas.remove();
      labels.domElement.remove();
      delete el.dataset.damping;
    },
  };
  return viz;
}
