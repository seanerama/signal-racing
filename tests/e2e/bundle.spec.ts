import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

/**
 * Stage 7 bundle budget, from the Vite manifest of `npm run build` (`dist/.vite/manifest.json`):
 * three.js is not in the initial chunk (entry + its static imports) and the initial JS stays
 * under 300 KB gzipped. The single-file build, by contrast, inlines three.
 */

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

const DIST = resolve(process.cwd(), 'dist');
const BUDGET_GZ = 300 * 1024;
/** Strings only three.js's renderer contains. */
const THREE_MARK = /WebGLRenderer|WebGLRenderTarget/;

function manifest(): Record<string, ManifestChunk> {
  return JSON.parse(readFileSync(resolve(DIST, '.vite/manifest.json'), 'utf8')) as Record<
    string,
    ManifestChunk
  >;
}

/** Keys of `key` and everything it statically imports. */
function staticClosure(m: Record<string, ManifestChunk>, key: string): string[] {
  const seen = new Set<string>();
  const walk = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    for (const i of m[k]?.imports ?? []) walk(i);
  };
  walk(key);
  return [...seen];
}

test.describe('bundle', () => {
  test('three.js is lazy and the initial JS is under 300 KB gzipped', () => {
    const m = manifest();
    const entryKey = Object.keys(m).find((k) => m[k]?.isEntry);
    expect(entryKey).toBeDefined();
    const initial = staticClosure(m, entryKey!);
    const files = initial.map((k) => m[k]!.file).filter((f) => f.endsWith('.js'));

    let gz = 0;
    for (const f of files) {
      const code = readFileSync(resolve(DIST, f));
      gz += gzipSync(code).length;
      expect(THREE_MARK.test(code.toString('utf8')), `three.js found in initial ${f}`).toBe(false);
    }
    for (const k of initial) expect(k).not.toMatch(/node_modules[\\/]three/);
    console.log(`initial JS: ${files.join(', ')} = ${(gz / 1024).toFixed(1)} KB gzipped`);
    expect(gz).toBeLessThan(BUDGET_GZ);

    // three.js is reachable, but only behind a dynamic import.
    const lazy = (m[entryKey!]!.dynamicImports ?? []).flatMap((k) => staticClosure(m, k));
    const lazyFiles = [...new Set(lazy.map((k) => m[k]!.file))].filter((f) => !files.includes(f));
    const threeChunk = lazyFiles.find((f) =>
      THREE_MARK.test(readFileSync(resolve(DIST, f), 'utf8')),
    );
    expect(threeChunk, 'no lazy chunk contains three.js').toBeDefined();
    const threeGz = gzipSync(readFileSync(resolve(DIST, threeChunk!))).length;
    console.log(`lazy three chunk: ${threeChunk} = ${(threeGz / 1024).toFixed(1)} KB gzipped`);
  });

  test('the single-file build inlines three.js', () => {
    const html = readFileSync(resolve(process.cwd(), 'dist-single/signal.html'), 'utf8');
    expect(THREE_MARK.test(html)).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=["'](?!data:)/);
  });
});
