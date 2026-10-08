/**
 * Name hygiene (Stage 9): no third-party team or company names ship. Scans `src/`, `index.html`,
 * `docs/`, and the built `dist/` and `dist-single/` when present. The banned list is assembled
 * from fragments so this file never contains the names it guards against.
 *
 * Also checks the disclaimer is wired into its four places.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from '@/game/disclaimer';

const ROOT = join(import.meta.dirname, '..', '..');

const BANNED: RegExp[] = [
  new RegExp(['gan', 'assi'].join(''), 'i'),
  new RegExp(['open', 'ai'].join(''), 'i'),
  new RegExp(`\\b${['c', 'g', 'r'].join('')}\\b`, 'i'),
];

const TEXT = /\.(ts|tsx|js|mjs|css|html|md|json|txt|svg|csv)$/i;

function walk(p: string): string[] {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => walk(join(p, n)));
}

const TARGETS = ['src', 'index.html', 'docs', 'dist', 'dist-single'].map((t) => join(ROOT, t));

describe('name hygiene', () => {
  it('no banned name in src/, index.html, docs/, dist/, dist-single/', () => {
    const hits: string[] = [];
    for (const file of TARGETS.flatMap(walk)) {
      if (!TEXT.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const re of BANNED) {
        const m = re.exec(text);
        if (m) hits.push(`${relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the guard itself catches a banned name', () => {
    const sample = `x ${['Gan', 'assi'].join('')} y ${['C', 'G', 'R'].join('')} z`;
    expect(BANNED.filter((re) => re.test(sample))).toHaveLength(2);
    expect(BANNED[2]!.test('cgroup')).toBe(false);
  });
});

describe('disclaimer', () => {
  it('is the exact copy', () => {
    expect(DISCLAIMER).toBe(
      'Independent educational prototype. Not affiliated with any racing team or company. The car is approximate and does not model any real vehicle.',
    );
  });
  it('is wired into the level-select footer, the Model page, the Puzzle brief and the CSV', () => {
    for (const f of [
      'src/app/LevelSelect.tsx',
      'src/app/ModelPage.tsx',
      'src/app/BriefModal.tsx',
      'src/export/csv.ts',
    ]) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toContain('DISCLAIMER');
    }
  });
});
