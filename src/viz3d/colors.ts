/**
 * Token → colour for the 3D data views (design-system "Three.js data views", "Sequential ramp").
 * Reads the CSS custom properties through the report's `cssVar` (same fallbacks), so projector
 * mode and token tweaks need no code change. Pure apart from the token read; no three.js here.
 */
import { cssVar, slotToken } from '@/report/uplot-theme';
import { luminance, rampColor, VIRIDIS } from '@/report/track-draw';

export { luminance, rampColor };

/** Run-age shading uses this slice of the ramp: the darkest stops vanish against `--bg`. */
export const AGE_FROM = 0.22;
export const AGE_TO = 0.88;

export interface VizColors {
  bg: string;
  panel: string;
  grid: string;
  rule: string;
  text: string;
  textDim: string;
  textFaint: string;
  best: string;
  /** `--seq-0 … --seq-8`. */
  ramp: string[];
}

/** The viridis ramp from `--seq-0…8` (falls back to the design values). */
export function readRamp(): string[] {
  return VIRIDIS.map((fallback, i) => cssVar(`--seq-${i}`) || fallback);
}

export function readVizColors(): VizColors {
  return {
    bg: cssVar('--bg'),
    panel: cssVar('--panel') || '#11141a',
    grid: cssVar('--grid'),
    rule: cssVar('--rule'),
    text: cssVar('--text'),
    textDim: cssVar('--text-dim'),
    textFaint: cssVar('--text-faint'),
    best: cssVar('--best') || '#b46cff',
    ramp: readRamp(),
  };
}

/** The current run's colour: the strip slot hue (`--t1…--t8`). */
export function slotHue(slot: number): string {
  return cssVar(slotToken(slot));
}

/**
 * Colours for `count` older runs, oldest first, on the viridis ramp by age (older = darker).
 * Luminance increases monotonically with recency.
 */
export function ageColors(count: number, ramp: readonly string[] = VIRIDIS): string[] {
  if (count <= 0) return [];
  if (count === 1) return [rampColor(AGE_TO, ramp)];
  return Array.from({ length: count }, (_, i) =>
    rampColor(AGE_FROM + ((AGE_TO - AGE_FROM) * i) / (count - 1), ramp),
  );
}

/** Parsed colour: channels 0–1. Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(css: string): Rgba {
  const s = css.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.replace(/(.)/g, '$1$1');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length >= 8 ? n(6) : 1 };
  }
  const m = s.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    const [r, g, b, a] = m.map(Number);
    return { r: (r ?? 0) / 255, g: (g ?? 0) / 255, b: (b ?? 0) / 255, a: a ?? 1 };
  }
  return { r: 1, g: 1, b: 1, a: 1 };
}
