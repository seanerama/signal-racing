/**
 * Minimal hash router. Hash routing works from `file://` (the single-file build), where the
 * History API cannot. Routes: `#/` (level select), `#/level/:id`, `#/level/:id/debrief`,
 * `#/dev/*`.
 */
import { signal } from '@preact/signals';
import type { LevelId } from '@/levels/types';
import { getLevel } from '@/levels/index';

function currentPath(): string {
  const h = globalThis.location?.hash ?? '';
  const path = h.replace(/^#/, '').replace(/\?.*$/, '');
  return path === '' ? '/' : path;
}

/** The current route path, e.g. `'/'` or `'/dev/worker'`. */
export const routePath = signal<string>(currentPath());

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    routePath.value = currentPath();
  });
}

export function navigate(path: string): void {
  globalThis.location.hash = path;
}

export type Route =
  | { name: 'select' }
  | { name: 'level'; id: LevelId }
  | { name: 'debrief'; id: LevelId }
  | { name: 'dev'; path: string }
  | { name: 'model' }
  | { name: 'missing'; path: string };

export function parseRoute(path: string): Route {
  if (path === '/' || path === '') return { name: 'select' };
  if (path === '/model' || path === '/model/') return { name: 'model' };
  if (path === '/dev' || path.startsWith('/dev/')) return { name: 'dev', path };
  const m = /^\/level\/([A-Za-z0-9]+)(\/debrief)?\/?$/.exec(path);
  if (m) {
    const level = getLevel(m[1]!);
    if (!level) return { name: 'missing', path };
    return m[2] ? { name: 'debrief', id: level.id } : { name: 'level', id: level.id };
  }
  return { name: 'missing', path };
}

export const levelPath = (id: LevelId): string => `/level/${id}`;
export const debriefPath = (id: LevelId): string => `/level/${id}/debrief`;

/** Stage 9: the Model & sources page. */
export const MODEL_PATH = '/model';
