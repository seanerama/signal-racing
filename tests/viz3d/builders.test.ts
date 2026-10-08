/**
 * Stage 7: the 3D views' geometry builders as pure functions (no WebGL needed).
 */
import { describe, expect, it } from 'vitest';
import type { ChannelId, LeverId, Setup } from '@/engine/types';
import type { LeverSpec } from '@/levels/types';
import { VIRIDIS } from '@/report/track-draw';
import { ageColors, luminance, parseColor } from '@/viz3d/colors';
import {
  buildResponse,
  leverTicks,
  makeLookup,
  marginalRanges,
  MAX_LEVER_LABELS,
  pickLeverPair,
  stepDecimals,
  stepValues,
  type Sample,
} from '@/viz3d/surface-data';
import {
  buildWaterfall,
  fastestRun,
  MAX_POINTS,
  splitFinite,
  strideIndices,
  type WaterfallRun,
} from '@/viz3d/waterfall-data';

// ---------- fixtures ----------

const BASE: Setup = { throttle_ramp: 0, tire_pressure: 1.9, weight_dist: 0.45, wing: 4 };

function fakeRun(index: number, time: number, n = 500, opts: { nanAt?: number[] } = {}) {
  const t = new Float32Array(n);
  const s = new Float32Array(n);
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i * 0.04;
    s[i] = i * 2;
    speed[i] = 10 + index + Math.sin(i / 30);
  }
  for (const i of opts.nanAt ?? []) speed[i] = NaN;
  const run: WaterfallRun = {
    index,
    setup: { ...BASE, throttle_ramp: index / 10 },
    outcome: { totalTime: time, finished: true },
    telemetry: { n, t, s, get: (id: ChannelId) => (id === 'speed' ? speed : new Float32Array(n)) },
  };
  return run;
}

const lever = (id: LeverId, min: number, max: number, step: number, q: LeverSpec['quantity']) =>
  ({ id, label: id, quantity: q, min, max, step, default: min }) as LeverSpec;

const RAMP = lever('throttle_ramp', 0, 1, 0.1, 'time');
const PRESSURE = lever('tire_pressure', 1.5, 2.1, 0.1, 'pressure');
const WING = lever('wing', 0, 8, 1, 'angle_int');

/** Full grid over `levers` with `f(setup)` as the outcome. */
function gridSamples(levers: LeverSpec[], f: (s: Setup) => number): Sample[] {
  let setups: Setup[] = [{ ...BASE }];
  for (const l of levers) {
    setups = setups.flatMap((s) => stepValues(l).map((v) => ({ ...s, [l.id]: v })));
  }
  return setups.map((setup) => ({ setup, totalTime: f(setup) }));
}

// Ramp matters most (bowl at 0.4), wing a little, pressure barely.
const outcome = (s: Setup) =>
  20 + 8 * (s.throttle_ramp - 0.4) ** 2 + 0.05 * (s.wing - 4) ** 2 + 0.001 * s.tire_pressure;

const rgbOf = (c: string) => luminance(c);

// ---------- waterfall ----------

describe('buildWaterfall', () => {
  const runs = [
    fakeRun(1, 21),
    fakeRun(2, 20.5),
    fakeRun(3, 20.1),
    fakeRun(4, 20.4),
    fakeRun(5, 20.3),
  ];
  const model = buildWaterfall({
    runs,
    channel: 'speed',
    quantity: 'speed',
    units: 'metric',
    axis: 'time',
    currentColor: '#4cc9f0',
    bestColor: '#b46cff',
    ramp: VIRIDIS,
  });

  it('has one ribbon per run, oldest first and at the back', () => {
    expect(model.ribbons).toHaveLength(runs.length);
    expect(model.ribbons.map((r) => r.runIndex)).toEqual([1, 2, 3, 4, 5]);
    const zs = model.ribbons.map((r) => r.z);
    expect(zs[zs.length - 1]).toBe(0);
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeGreaterThan(zs[i - 1]!);
    expect(model.zTicks.map((t) => t.label)).toEqual(['RUN 1', 'RUN 2', 'RUN 3', 'RUN 4', 'RUN 5']);
  });

  it('vertex count equals the decimated sample count', () => {
    for (const r of model.ribbons) {
      const verts = r.pieces.reduce((a, p) => a + p.length / 3, 0);
      expect(verts).toBe(strideIndices(500).length);
      expect(verts).toBeLessThanOrEqual(MAX_POINTS + 1);
    }
  });

  it('colours: current = slot hue, best = --best, older by age with rising luminance', () => {
    const byIdx = new Map(model.ribbons.map((r) => [r.runIndex, r]));
    expect(byIdx.get(5)!.role).toBe('current');
    expect(byIdx.get(5)!.color).toBe('#4cc9f0');
    expect(byIdx.get(3)!.role).toBe('best');
    expect(byIdx.get(3)!.color).toBe('#b46cff');
    const history = model.ribbons.filter((r) => r.role === 'history');
    expect(history.map((r) => r.runIndex)).toEqual([1, 2, 4]);
    const lum = history.map((r) => rgbOf(r.color));
    for (let i = 1; i < lum.length; i++) expect(lum[i]!).toBeGreaterThan(lum[i - 1]!);
  });

  it('a current run that is also best stays in its slot hue and is flagged best', () => {
    const m = buildWaterfall({
      runs: [fakeRun(1, 21), fakeRun(2, 20)],
      channel: 'speed',
      quantity: 'speed',
      units: 'metric',
      axis: 'distance',
      currentColor: '#ffb020',
      bestColor: '#b46cff',
      ramp: VIRIDIS,
    });
    const cur = m.ribbons[1]!;
    expect(cur.role).toBe('current');
    expect(cur.isBest).toBe(true);
    expect(cur.color).toBe('#ffb020');
    expect(m.xTitle).toBe('s · m');
    expect(m.yTitle).toBe('speed · km/h');
  });

  it('dropouts split a ribbon into pieces (gaps, not bridges)', () => {
    const m = buildWaterfall({
      runs: [fakeRun(1, 20, 100, { nanAt: [50] })],
      channel: 'speed',
      quantity: 'speed',
      units: 'metric',
      axis: 'time',
      currentColor: '#fff',
      bestColor: '#b46cff',
      ramp: VIRIDIS,
    });
    expect(m.ribbons[0]!.pieces).toHaveLength(2);
    expect(m.ribbons[0]!.pieces.reduce((a, p) => a + p.length / 3, 0)).toBe(99);
  });

  it('positions stay inside the plot box; y is in display units', () => {
    for (const r of model.ribbons) {
      for (const p of r.pieces) {
        for (let i = 0; i < p.length; i += 3) {
          expect(p[i]!).toBeGreaterThanOrEqual(-1e-5);
          expect(p[i]!).toBeLessThanOrEqual(model.box.w + 1e-5);
          expect(p[i + 1]!).toBeGreaterThanOrEqual(-1e-5);
          expect(p[i + 1]!).toBeLessThanOrEqual(model.box.h + 1e-5);
        }
      }
    }
    // speed 10–16 m/s → 36–58 km/h: the y ticks are km/h values.
    const labels = model.yTicks.map((t) => Number(t.label));
    expect(Math.min(...labels)).toBeGreaterThan(30);
    expect(Math.max(...labels)).toBeLessThan(65);
  });

  it('helpers: fastestRun ignores DNFs; splitFinite drops 1-point pieces', () => {
    const dnf = { ...fakeRun(9, 1), outcome: { totalTime: 1, finished: false } };
    expect(fastestRun([fakeRun(1, 20), dnf, fakeRun(2, 19)])).toBe(2);
    expect(fastestRun([])).toBeNull();
    expect(splitFinite([0, 1, 2, 3], [1, NaN, 2, 3], [0, 1, 2, 3])).toEqual([
      [
        [2, 2],
        [3, 3],
      ],
    ]);
  });
});

describe('ageColors', () => {
  it.each([2, 3, 5, 12, 40])('is monotonic in luminance for %i runs', (n) => {
    const lum = ageColors(n, VIRIDIS).map(luminance);
    for (let i = 1; i < lum.length; i++) expect(lum[i]!).toBeGreaterThan(lum[i - 1]!);
  });
  it('never uses the darkest stop (invisible on --bg)', () => {
    expect(luminance(ageColors(10)[0]!)).toBeGreaterThan(luminance(VIRIDIS[1]!));
  });
});

describe('parseColor', () => {
  it('reads hex with alpha and rgb()', () => {
    expect(parseColor('#7a8494b3').a).toBeCloseTo(0.702, 2);
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor('rgb(255, 0, 51)')).toEqual({ r: 1, g: 0, b: 0.2, a: 1 });
  });
});

// ---------- response surface ----------

describe('lever-pair picker', () => {
  const samples = gridSamples([RAMP, PRESSURE, WING], outcome);

  it('ranks levers by marginal range', () => {
    const r = marginalRanges([RAMP, PRESSURE, WING], samples);
    expect(r.get('throttle_ramp')!).toBeGreaterThan(r.get('wing')!);
    expect(r.get('wing')!).toBeGreaterThan(r.get('tire_pressure')!);
  });

  it('chooses the two most influential, in level order', () => {
    expect(pickLeverPair([RAMP, PRESSURE, WING], samples).map((l) => l.id)).toEqual([
      'throttle_ramp',
      'wing',
    ]);
    expect(pickLeverPair([WING, PRESSURE, RAMP], samples).map((l) => l.id)).toEqual([
      'wing',
      'throttle_ramp',
    ]);
  });

  it('two or fewer levers pass through unchanged', () => {
    expect(pickLeverPair([PRESSURE, RAMP], samples).map((l) => l.id)).toEqual([
      'tire_pressure',
      'throttle_ramp',
    ]);
    expect(pickLeverPair([RAMP], samples)).toEqual([RAMP]);
  });
});

describe('buildResponse', () => {
  const levers = [RAMP, PRESSURE];
  const f = (s: Setup) => 20 + 8 * (s.throttle_ramp - 0.4) ** 2 + 2 * (s.tire_pressure - 1.8) ** 2;
  const samples = gridSamples(levers, f);
  const optimum = { setup: { ...BASE, throttle_ramp: 0.4, tire_pressure: 1.8 }, totalTime: 20 };
  const runs = [
    { index: 1, setup: { ...BASE }, outcome: { totalTime: f(BASE), finished: true } },
    {
      index: 2,
      setup: { ...BASE, throttle_ramp: 0.3, tire_pressure: 1.8 },
      outcome: { totalTime: 20.1, finished: true },
    },
    { index: 3, setup: { ...BASE }, outcome: { totalTime: 99, finished: false } },
  ];

  it('builds an nx × nz surface with exact values where evaluated', () => {
    const m = buildResponse({ levers, samples, optimum, runs, units: 'metric', ramp: VIRIDIS });
    expect(m.kind).toBe('surface');
    if (m.kind !== 'surface') return;
    expect(m.nx).toBe(11);
    expect(m.nz).toBe(7);
    expect(m.positions.length).toBe(11 * 7 * 3);
    expect(m.colors.length).toBe(11 * 7 * 3);
    expect(m.interpolated).toBe(0);
    // Cell (ramp 0.4, pressure 1.8) = 20 exactly.
    expect(m.times[3 * 11 + 4]).toBeCloseTo(20, 9);
    // Fast = bright: the optimum vertex is the most luminous.
    const lumAt = (j: number) =>
      0.2126 * m.colors[j * 3]! + 0.7152 * m.colors[j * 3 + 1]! + 0.0722 * m.colors[j * 3 + 2]!;
    expect(lumAt(3 * 11 + 4)).toBeGreaterThan(lumAt(0));
  });

  it('places finished runs only, in order, and the optimum at its time', () => {
    const m = buildResponse({ levers, samples, optimum, runs, units: 'metric', ramp: VIRIDIS });
    expect(m.runs.map((r) => r.index)).toEqual([1, 2]);
    expect(m.optimum.time).toBe(20);
    // The optimum is the lowest point in the scene.
    for (const r of m.runs) expect(r.y).toBeGreaterThan(m.optimum.y);
    expect(m.optimum.y).toBeGreaterThanOrEqual(0);
  });

  it('interpolates cells that were never evaluated and reports how many', () => {
    const sparse = samples.filter((_, i) => i % 3 !== 0);
    const m = buildResponse({
      levers,
      samples: sparse,
      optimum,
      runs,
      units: 'metric',
      ramp: VIRIDIS,
    });
    expect(m.interpolated).toBe(samples.length - sparse.length);
    const [lo, hi] = [
      Math.min(...samples.map((s) => s.totalTime)),
      Math.max(...samples.map((s) => s.totalTime)),
    ];
    for (const t of m.times) {
      expect(t).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(t).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it('holds the other levers at the optimum (3 levers → 2 axes + 1 fixed)', () => {
    const s3 = gridSamples([RAMP, PRESSURE, WING], outcome);
    const opt = {
      setup: { ...BASE, throttle_ramp: 0.4, wing: 4, tire_pressure: 1.5 },
      totalTime: 20.0015,
    };
    const m = buildResponse({
      levers: [RAMP, PRESSURE, WING],
      samples: s3,
      optimum: opt,
      runs: [],
      units: 'metric',
      ramp: VIRIDIS,
    });
    expect(m.levers.map((l) => l.id)).toEqual(['throttle_ramp', 'wing']);
    expect(m.fixed.map((x) => [x.lever.id, x.value])).toEqual([['tire_pressure', 1.5]]);
    expect(m.interpolated).toBe(0);
  });

  it('one unlocked lever gives a 2D curve', () => {
    const one = gridSamples([RAMP], outcome);
    const m = buildResponse({
      levers: [RAMP],
      samples: one,
      optimum: {
        setup: { ...BASE, throttle_ramp: 0.4 },
        totalTime: outcome({ ...BASE, throttle_ramp: 0.4 }),
      },
      runs,
      units: 'metric',
      ramp: VIRIDIS,
    });
    expect(m.kind).toBe('curve');
    expect(m.positions.length).toBe(11 * 3);
    expect(m.box.d).toBe(0);
    for (let i = 2; i < m.positions.length; i += 3) expect(m.positions[i]).toBe(0);
  });

  it('lever axes tick at discrete steps, thinned, with step-appropriate decimals', () => {
    const fine = lever('throttle_ramp', 0, 1.5, 0.05, 'time');
    const ticks = leverTicks(fine, 'metric', (v) => v);
    expect(ticks.length).toBeLessThanOrEqual(MAX_LEVER_LABELS);
    for (const t of ticks) {
      const k = t.pos / 0.05;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
    expect(stepDecimals(RAMP, 'metric')).toBe(1);
    expect(stepDecimals(PRESSURE, 'imperial')).toBe(1); // 0.1 bar = 1.45 psi
    expect(stepDecimals(WING, 'metric')).toBe(0);
    expect(leverTicks(PRESSURE, 'metric', (v) => v).map((t) => t.label)[0]).toBe('1.5');
  });

  it('lookup returns the exact sample when present', () => {
    const look = makeLookup(levers, samples);
    expect(look([4, 3])).toEqual([20, false]);
  });
});
