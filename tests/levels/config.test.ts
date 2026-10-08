/**
 * Contract 04 validation for the Stage 6 levels (A1–A4): roles cover the channel set, defaults
 * are never causal, lever defaults lie on the step grid, ids exist in the registry, and tier-3
 * strings never carry a lever value.
 */
import { describe, expect, it } from 'vitest';
import { leverGrid } from '@/game/grid-search';
import { A2, LEVELS, getLevel } from '@/levels/index';
import { RAMP_MAX } from '@/levels/common';
import { hasChannel } from '@/telemetry/registry';

/** A digit (with optional decimals) next to a lever unit, e.g. `0.4 s`, `1.7bar`, `4°`. */
const VALUE_WITH_UNIT = /\d(?:[.,]\d+)?\s*(?:s|bar|psi|%|°|deg|kg|m)\b/i;
/** A bare lever value such as "wing 4" or "to 0.45". */
const LEVER_VALUE = /\b(?:to|at|wing|ramp|pressure|distribution)\s+\d/i;

const sentences = (text: string): number =>
  text
    .replace(/`[^`]*`/g, 'x')
    .split(/(?<=[.!?])\s+/)
    .filter((x) => x.trim().length > 0).length;

describe('LEVELS', () => {
  it('ships A1–A4, B1L, B4L in unlock order', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1L', 'B4L']);
    expect(getLevel('A2')).toBe(A2);
    expect(getLevel('B9')).toBeUndefined();
  });

  it('the amended ramp range is 0–3.0 s step 0.2 (clamped to the engine on this branch)', () => {
    for (const l of LEVELS) {
      const ramp = l.levers.find((x) => x.id === 'throttle_ramp');
      if (!ramp) {
        // Stage 11: A4 locks the ramp (only the wing is free); the locked value is on that grid.
        const v = l.lockedLevers.throttle_ramp!;
        expect(Math.abs(v / 0.2 - Math.round(v / 0.2)), l.id).toBeLessThan(1e-9);
        continue;
      }
      expect(ramp).toMatchObject({ min: 0, step: 0.2 });
      expect(ramp.max).toBeCloseTo(RAMP_MAX, 9);
      expect(ramp.max).toBeLessThanOrEqual(3.0);
    }
  });

  it('signal-to-noise falls monotonically, from 1 in 4 at A1 toward 1 in 30 at the Puzzle', () => {
    // Stage 11 (finding 6): total channels per causal channel, in unlock order.
    const ratio = LEVELS.map((l) => {
      const causal = l.channelSet.filter((id) => l.channelRoles[id] === 'causal').length;
      return l.channelSet.length / causal;
    });
    for (let i = 1; i < ratio.length; i++) expect(ratio[i]!).toBeGreaterThan(ratio[i - 1]!);
    expect(ratio[0]!).toBeCloseTo(4, 0);
    expect(ratio[ratio.length - 1]!).toBeGreaterThanOrEqual(25);
    expect(ratio[ratio.length - 1]!).toBeLessThanOrEqual(30);
  });

  it('the axle forces (Stage 9) are never causal: they feed the grip circle, not the lesson', () => {
    for (const l of LEVELS)
      for (const id of ['fx_front', 'fy_front', 'fx_rear', 'fy_rear'])
        expect(l.channelRoles[id], `${l.id} ${id}`).toBe('correlated');
  });
});

describe.each(LEVELS.map((l) => [l.id, l] as const))('%s config', (_id, level) => {
  const causal = level.channelSet.filter((id) => level.channelRoles[id] === 'causal');

  it('roles cover exactly the channel set; every id is in the registry', () => {
    expect(new Set(Object.keys(level.channelRoles))).toEqual(new Set(level.channelSet));
    expect(new Set(level.channelSet).size).toBe(level.channelSet.length);
    for (const id of level.channelSet) expect(hasChannel(id), id).toBe(true);
  });

  it('default strips: 4–6, on the level, never causal', () => {
    expect(level.defaultStrips.length).toBeGreaterThanOrEqual(4);
    expect(level.defaultStrips.length).toBeLessThanOrEqual(6);
    for (const id of level.defaultStrips) {
      expect(level.channelSet).toContain(id);
      expect(level.channelRoles[id], id).not.toBe('causal');
    }
  });

  it('channel and causal counts follow the meeting-cut growth', () => {
    // Stage 9 adds the four axle-force channels (grip circle) to every level; Stage 11 adds B1L
    // distractors and makes the forces correlated everywhere (signal-to-noise, finding 6).
    const want = { A1: 16, A2: 25, A3: 32, A4: 41, B1L: 60, B4L: 215 }[level.id];
    expect(Math.abs(level.channelSet.length - want)).toBeLessThanOrEqual(
      level.id === 'B4L' ? 10 : 2,
    );
    const ranges: Record<string, [number, number]> = {
      A1: [4, 4],
      A2: [5, 5],
      A3: [4, 4],
      A4: [4, 4],
      B1L: [5, 5],
      B4L: [8, 8],
    };
    const [lo, hi] = ranges[level.id]!;
    expect(causal.length).toBeGreaterThanOrEqual(lo);
    expect(causal.length).toBeLessThanOrEqual(hi);
    expect(new Set(level.debrief.causal)).toEqual(new Set(causal));
  });

  it('lever defaults lie on the step grid; locked levers are not unlocked', () => {
    for (const l of level.levers) {
      expect(
        leverGrid(l).some((v) => Math.abs(v - l.default) < 1e-9),
        l.id,
      ).toBe(true);
      expect(level.lockedLevers[l.id], l.id).toBeUndefined();
    }
    const all = new Set([...level.levers.map((l) => l.id), ...Object.keys(level.lockedLevers)]);
    expect(all).toEqual(new Set(['throttle_ramp', 'tire_pressure', 'weight_dist', 'wing']));
  });

  it('surface levers (Stage 11), when set, are two different unlocked levers', () => {
    if (!level.surfaceLevers) return;
    const [a, b] = level.surfaceLevers;
    expect(a).not.toBe(b);
    for (const id of [a, b]) expect(level.levers.map((l) => l.id)).toContain(id);
  });

  it('has fault and headroom rules with unique ids (A1 has no grip limit, so no fault)', () => {
    const ids = level.hintRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(level.hintRules.some((r) => r.kind === 'headroom')).toBe(true);
    if (level.id !== 'A1') expect(level.hintRules.some((r) => r.kind === 'fault')).toBe(true);
  });

  it('tier 3 names a lever and a direction, never a value', () => {
    for (const r of level.hintRules) {
      // The generic noise rule directs a method (repeat, compare like with like), not a lever.
      if (r.kind === 'noise') continue;
      const t3 = r.tiers[2];
      if (r.fallback) {
        // The generic headroom rule (Stage 11) names its lever and direction through `{move}`,
        // one of the fixed phrases in LEVER_MOVES (checked in tests/hints/headroom.test.ts).
        expect(t3, r.id).toMatch(/^\{move\}/);
        expect(t3, r.id).not.toMatch(VALUE_WITH_UNIT);
        continue;
      }
      expect(t3, r.id).not.toMatch(VALUE_WITH_UNIT);
      expect(t3, r.id).not.toMatch(LEVER_VALUE);
      expect(t3, r.id).toMatch(/throttle ramp|tire pressure|weight distribution|wing/i);
      expect(t3, r.id).toMatch(/^(Shorten|Lengthen|Raise|Lower|Move|\{dir\}) /);
    }
  });

  it('brief and debrief copy: terse, no exclamation marks', () => {
    const n = sentences(level.brief);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
    const all = [level.brief, ...level.debrief.physics, ...level.hintRules.flatMap((r) => r.tiers)];
    for (const t of all) expect(t).not.toContain('!');
  });

  it('every template channel id is on the level', () => {
    const texts = [
      level.brief,
      ...level.debrief.physics,
      ...level.hintRules.flatMap((r) => r.tiers),
    ];
    for (const t of texts) {
      for (const m of t.matchAll(/`([a-z0-9_]+)`/g)) expect(level.channelSet, t).toContain(m[1]);
    }
  });
});

describe('copy specifics', () => {
  it('A2 wheelspin tier 3 lengthens the ramp (a longer ramp reduces wheelspin here)', () => {
    const r = A2.hintRules.find((x) => x.id === 'wheelspin')!;
    expect(r.tiers[2]).toMatch(/^Lengthen the throttle ramp/);
  });

  it('A1 brief points at the table and the strips to pull in; A4 brief points at the track view', () => {
    const [a1, , , a4] = LEVELS;
    expect(a1!.brief).toMatch(/table on the right/);
    for (const id of ['long_g', 'drag_force']) expect(a1!.brief).toContain(`\`${id}\``);
    expect(a4!.brief).toMatch(/where on the path the speed bottoms out/);
  });
});
