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
  it('ships A1–A4 in unlock order', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(getLevel('A2')).toBe(A2);
    expect(getLevel('B9')).toBeUndefined();
  });

  it('the amended ramp range is 0–3.0 s step 0.2 (clamped to the engine on this branch)', () => {
    for (const l of LEVELS) {
      const ramp = l.levers.find((x) => x.id === 'throttle_ramp');
      expect(ramp).toMatchObject({ min: 0, step: 0.2 });
      expect(ramp?.max).toBeCloseTo(RAMP_MAX, 9);
      expect(ramp!.max).toBeLessThanOrEqual(3.0);
    }
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
    const want = { A1: 12, A2: 20, A3: 28, A4: 36 }[level.id as 'A1'];
    expect(Math.abs(level.channelSet.length - want)).toBeLessThanOrEqual(2);
    expect(causal.length).toBeGreaterThanOrEqual(3);
    expect(causal.length).toBeLessThanOrEqual(5);
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

  it('has fault and headroom rules with unique ids (A1 has no grip limit, so no fault)', () => {
    const ids = level.hintRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(level.hintRules.some((r) => r.kind === 'headroom')).toBe(true);
    if (level.id !== 'A1') expect(level.hintRules.some((r) => r.kind === 'fault')).toBe(true);
  });

  it('tier 3 names a lever and a direction, never a value', () => {
    for (const r of level.hintRules) {
      const t3 = r.tiers[2];
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
