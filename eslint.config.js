// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Import boundaries (project-plan.md, "Import rule"):
 * - `src/engine/**` is pure: it may import only from `src/engine/**` (no packages, no other src dirs).
 * - The non-UI layers may not import UI packages (preact, @preact/signals, uplot, three) or UI dirs
 *   (`src/report|setup|app|debrief|viz3d`). The one exception is the logger, `src/app/log.ts`,
 *   which is framework-free and shared by every layer except the engine (the engine never logs).
 *
 * Two rules enforce this together: `no-restricted-imports` matches the import specifier
 * (packages and `@/` aliases), and `import/no-restricted-paths` matches the resolved file
 * (catching relative paths such as `../units`). `tests/lint/boundaries.test.ts` proves both.
 */
const UI_PACKAGES = ['preact', '@preact/signals', 'uplot', 'three'];
const UI_DIRS = ['report', 'setup', 'debrief', 'viz3d'];
const PURE_DIRS = ['telemetry', 'levels', 'hints', 'assist', 'game', 'units', 'export'];
const TS_GLOB = '**/*.{ts,tsx}';

const ENGINE_MSG = 'src/engine is pure: it may import only from src/engine/**.';
const PURE_MSG =
  'Non-UI layers (telemetry, levels, hints, assist, game, units, export) may not import UI ' +
  'packages (preact, @preact/signals, uplot, three) or UI dirs (report, setup, app, debrief, viz3d). ' +
  'Only @/app/log is allowed.';

export default defineConfig(
  {
    ignores: [
      'dist/',
      'dist-single/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'sdd-output/',
      'node_modules/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Component props use method syntax (contract 07: `onToggle(id): void`) and are destructured;
    // props objects are plain data, never `this`-bound, so this rule only produces noise here.
    files: ['**/*.tsx'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['*.{js,ts}', 'tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // ---- Boundary: resolved-path zones (covers relative imports) ----
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './src/engine', from: './src', except: ['./engine'], message: ENGINE_MSG },
            ...UI_DIRS.map((dir) => ({
              target: PURE_DIRS.map((d) => `./src/${d}`),
              from: `./src/${dir}`,
              message: PURE_MSG,
            })),
            {
              target: PURE_DIRS.map((d) => `./src/${d}`),
              from: './src/app',
              except: ['./log.ts'],
              message: PURE_MSG,
            },
          ],
        },
      ],
    },
  },

  // ---- Boundary: specifier rules (packages and @/ aliases) ----
  {
    files: [`src/engine/${TS_GLOB}`],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^(?!\\.\\.?/|@/engine(/|$))', message: ENGINE_MSG }] },
      ],
    },
  },
  {
    files: PURE_DIRS.map((d) => `src/${d}/${TS_GLOB}`),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: UI_PACKAGES.map((name) => ({ name, message: PURE_MSG })),
          patterns: [
            { regex: '^(preact|uplot|three|@preact/signals)/', message: PURE_MSG },
            { regex: `^@/(${UI_DIRS.join('|')})(/|$)`, message: PURE_MSG },
            { regex: '^@/app(?!/log$)(/|$)', message: PURE_MSG },
          ],
        },
      ],
    },
  },
);
