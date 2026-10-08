import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { baseConfig } from './vite.shared.ts';

const OUT_DIR = 'dist-single';
const OUT_FILE = 'signal.html';

/** Renames the emitted `index.html` to `signal.html` once the bundle is on disk. */
function renameHtml(outDir: string, fileName: string): Plugin {
  return {
    name: 'signal:rename-html',
    apply: 'build',
    closeBundle() {
      const from = resolve(outDir, 'index.html');
      if (existsSync(from)) renameSync(from, resolve(outDir, fileName));
    },
  };
}

/**
 * Meeting fallback: `npm run build:single` → `dist-single/signal.html`, one self-contained file
 * (JS, CSS, fonts and the sim worker inlined) that opens straight from disk with no server.
 */
export default defineConfig(
  mergeConfig(baseConfig({ singleFile: true }), {
    plugins: [viteSingleFile({ removeViteModuleLoader: true }), renameHtml(OUT_DIR, OUT_FILE)],
    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      // Inline every asset (fonts included) as a data: URI.
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
    },
  }),
);
