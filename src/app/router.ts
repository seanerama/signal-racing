/**
 * Minimal hash router. Hash routing works from `file://` (the single-file build), where the
 * History API cannot. Routes look like `#/dev/worker`.
 */
import { signal } from '@preact/signals';

function currentPath(): string {
  const h = globalThis.location?.hash ?? '';
  const path = h.replace(/^#/, '');
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
