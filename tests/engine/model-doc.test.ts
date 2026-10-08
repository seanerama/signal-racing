// @vitest-environment jsdom
/**
 * The Model page's registry (Stage 9): every equation maps to a function the engine module it
 * names actually exports, every contract-02 row the engine implements is documented, the MathML
 * parses as MathML, and the car table covers `DEFAULT_CAR` exactly.
 */
import { describe, expect, it } from 'vitest';
import * as corner from '@/engine/corner';
import * as physics from '@/engine/physics';
import * as simulateModule from '@/engine/simulate';
import { DEFAULT_CAR } from '@/engine/car';
import { CAR_PARAM_DOC, MODEL_EQUATIONS, NOT_MODELLED } from '@/engine/model-doc';

const MODULES: Record<string, Record<string, unknown>> = {
  physics,
  corner,
  simulate: simulateModule,
};

describe('MODEL_EQUATIONS', () => {
  it('ids are unique', () => {
    const ids = MODEL_EQUATIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('row labels are unique (the Model page numbers its rows by them)', () => {
    const rows = MODEL_EQUATIONS.map((e) => e.row);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('every equation maps to an implemented engine function', () => {
    for (const e of MODEL_EQUATIONS) {
      expect(e.impl.length, e.id).toBeGreaterThan(0);
      for (const name of e.impl) {
        expect(typeof MODULES[e.module]?.[name], `${e.id}: ${e.module}.${name}`).toBe('function');
      }
    }
  });

  it('documents every implemented contract-02 row (1–22 and 12b)', () => {
    const rows = new Set(MODEL_EQUATIONS.map((e) => e.row));
    for (const r of [...Array.from({ length: 22 }, (_, i) => String(i + 1)), '12b']) {
      expect(rows.has(r), `row ${r}`).toBe(true);
    }
  });

  it('each entry is one line: MathML, a plain-text twin, one sentence', () => {
    for (const e of MODEL_EQUATIONS) {
      expect(e.mathml.startsWith('<math'), e.id).toBe(true);
      expect(e.mathml.endsWith('</math>'), e.id).toBe(true);
      const doc = new DOMParser().parseFromString(e.mathml, 'application/xml');
      expect(doc.getElementsByTagName('parsererror'), e.id).toHaveLength(0);
      expect(e.plain.length, e.id).toBeGreaterThan(5);
      expect(e.plain, e.id).not.toContain('\n');
      expect(e.note.trim().split(/(?<=\.)\s+/), e.id).toHaveLength(1);
    }
  });

  it('lists what is deliberately not modelled', () => {
    const text = NOT_MODELLED.join(' ').toLowerCase();
    for (const w of ['yaw', 'suspension', 'temperature', 'fuel', 'gear-shift']) {
      expect(text).toContain(w);
    }
  });
});

describe('CAR_PARAM_DOC', () => {
  it('covers DEFAULT_CAR exactly, once per key', () => {
    expect(CAR_PARAM_DOC.map((r) => r.key).sort()).toEqual(Object.keys(DEFAULT_CAR).sort());
  });
  it('every row has a unit source', () => {
    for (const r of CAR_PARAM_DOC) expect(!!r.quantity || !!r.unit, r.key).toBe(true);
  });
});
