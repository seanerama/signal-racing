/**
 * Acceptance: no main-thread call to `simulate` anywhere. Only worker-side modules may import or
 * call it: the engine itself, the worker handlers, and the grid search (which only the worker
 * handlers import).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
  });
}

const WORKER_SIDE = new Set(['src/worker/handlers.ts', 'src/game/grid-search.ts']);
/** Modules allowed to import `grid-search` (it calls simulate). */
const GRID_IMPORTERS = new Set(['src/worker/handlers.ts']);

describe('no main-thread simulate', () => {
  const all = files(SRC).map((p) => ({ rel: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

  const importsSimulate = (text: string): boolean =>
    /import\s*{[^}]*\bsimulate\b[^}]*}\s*from\s*['"][^'"]*engine[^'"]*['"]/.test(text) ||
    /import\s*\*\s*as\s+\w+\s+from\s*['"][^'"]*engine(\/index|\/simulate)?['"]/.test(text);

  it('the detector sees the sanctioned worker-side imports', () => {
    for (const rel of WORKER_SIDE) {
      expect(importsSimulate(all.find((f) => f.rel === rel)!.text), rel).toBe(true);
    }
  });

  it('only worker-side modules import the engine simulate (or the whole engine namespace)', () => {
    const offenders = all
      .filter(({ rel }) => !rel.startsWith('src/engine/') && !WORKER_SIDE.has(rel))
      .filter(({ text }) => importsSimulate(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('only the worker handlers import the grid search', () => {
    const offenders = all
      .filter(({ rel }) => !GRID_IMPORTERS.has(rel))
      .filter(({ text }) => /from\s+['"][^'"]*grid-search['"]/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('the worker handlers are only imported by the worker entry', () => {
    const offenders = all
      .filter(({ rel }) => rel !== 'src/worker/sim.worker.ts')
      // value imports only (`import type { … }` is erased)
      .filter(({ text }) => /import\s+(?!type\b)[^;]*from\s+['"][^'"]*\/handlers['"]/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
