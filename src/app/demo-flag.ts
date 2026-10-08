/**
 * The meeting demo profile flag: `?demo=1` in the URL (before or inside the hash, e.g.
 * `signal.html?demo=1#/level/B4L` or `#/level/B4L?demo=1`). Once seen it sticks for the browser
 * tab (sessionStorage), so in-app navigation that rewrites the hash keeps it.
 */
import { signal } from '@preact/signals';

const KEY = 'signal.demo';

export function readDemoFlag(loc: Pick<Location, 'search' | 'hash'> | undefined): boolean {
  if (!loc) return false;
  const hashQuery = loc.hash.includes('?') ? loc.hash.slice(loc.hash.indexOf('?')) : '';
  for (const q of [loc.search, hashQuery]) {
    const v = new URLSearchParams(q).get('demo');
    if (v === '1' || v === 'true') return true;
  }
  return false;
}

function initial(): boolean {
  const fromUrl = readDemoFlag(globalThis.location);
  try {
    if (fromUrl) globalThis.sessionStorage?.setItem(KEY, '1');
    return fromUrl || globalThis.sessionStorage?.getItem(KEY) === '1';
  } catch {
    return fromUrl;
  }
}

/** True while the demo profile is active (shows the `DEMO PROFILE` chip). */
export const demoProfile = signal<boolean>(initial());
