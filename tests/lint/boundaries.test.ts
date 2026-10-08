/**
 * Proves the ESLint import boundaries (project-plan.md "Import rule") using the real
 * eslint.config.js: lint in-memory sources as if they lived at real paths under src/.
 */
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const BOUNDARY_RULES = new Set(['no-restricted-imports', 'import/no-restricted-paths']);

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

/** Lints `code` as if it were the (existing) file at `filePath`; returns boundary violations. */
async function boundaryErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (!result) throw new Error('no lint result');
  const fatal = result.messages.filter((m) => m.fatal);
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('\n'));
  return result.messages
    .filter((m) => m.ruleId !== null && BOUNDARY_RULES.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

// Real files, so type-aware linting can place them in the TS project.
const ENGINE_FILE = 'src/engine/rng.ts';
const UNITS_FILE = 'src/units/index.ts';
const TELEMETRY_FILE = 'src/telemetry/types.ts';
const GAME_FILE = 'src/game/types.ts';

describe('eslint boundary: src/engine is pure', () => {
  it('fails when src/engine imports src/units (relative)', async () => {
    const errs = await boundaryErrors(
      ENGINE_FILE,
      "import { unitLabel } from '../units';\nexport const x = unitLabel;\n",
    );
    expect(errs.some((e) => e.startsWith('import/no-restricted-paths'))).toBe(true);
  });

  it('fails when src/engine imports src/units (alias)', async () => {
    const errs = await boundaryErrors(
      ENGINE_FILE,
      "import { unitLabel } from '@/units';\nexport const x = unitLabel;\n",
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  it('fails when src/engine imports a package', async () => {
    const errs = await boundaryErrors(
      ENGINE_FILE,
      "import { signal } from '@preact/signals-core';\nexport const x = signal(1);\n",
    );
    expect(errs.some((e) => e.startsWith('no-restricted-imports'))).toBe(true);
  });

  it('allows imports within src/engine', async () => {
    const errs = await boundaryErrors(
      ENGINE_FILE,
      "import type { Setup } from './types';\nimport type { Track } from '@/engine/types';\nexport type X = [Setup, Track];\n",
    );
    expect(errs).toEqual([]);
  });
});

describe('eslint boundary: non-UI layers never import UI', () => {
  for (const pkg of ['preact', 'preact/hooks', '@preact/signals', 'uplot', 'three']) {
    it(`fails when src/telemetry imports ${pkg}`, async () => {
      const errs = await boundaryErrors(
        TELEMETRY_FILE,
        `import * as m from '${pkg}';\nexport const x = m;\n`,
      );
      expect(errs.length).toBeGreaterThan(0);
    });
  }

  it('fails when src/units imports src/report (relative)', async () => {
    const errs = await boundaryErrors(
      UNITS_FILE,
      "import type { StripStackProps } from '../report/types';\nexport type X = StripStackProps;\n",
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  it('fails when src/game imports src/app (not the logger)', async () => {
    const errs = await boundaryErrors(
      GAME_FILE,
      "import { App } from '@/app/App';\nexport const x = App;\n",
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  it('allows the logger, signals-core, engine and worker types', async () => {
    const errs = await boundaryErrors(
      GAME_FILE,
      [
        "import { log } from '@/app/log';",
        "import { log as log2 } from '../app/log';",
        "import { signal } from '@preact/signals-core';",
        "import type { Setup } from '@/engine/types';",
        "import type { GridResult } from '@/worker/types';",
        'export const x = [log, log2, signal];',
        'export type Y = [Setup, GridResult];',
        '',
      ].join('\n'),
    );
    expect(errs).toEqual([]);
  });
});
