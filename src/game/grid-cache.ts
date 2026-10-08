/**
 * Main-thread grid-search cache (contract 05): in memory, keyed by `${levelId}:${configHash}`.
 *
 * Order: the in-memory cache, then the build's precomputed targets (`precomputed.ts`, used only
 * when the key matches the current config hash exactly), then the live search in the worker via
 * the `SimClient`. A failed search is evicted so the next call retries.
 */
import { log } from '@/app/log';
import type { LevelConfig } from '@/levels/types';
import type { GridResult, SimClient } from '@/worker/types';
import { gridKey } from './config-hash';
import { precomputedGrid } from './precomputed';

const cache = new Map<string, Promise<GridResult>>();

export function loadGrid(
  level: LevelConfig,
  client: SimClient,
  onProgress?: (frac: number) => void,
): Promise<GridResult> {
  const key = gridKey(level);
  const hit = cache.get(key);
  if (hit) {
    onProgress?.(1);
    return hit;
  }
  const live = (): Promise<GridResult> => {
    const t0 = performance.now();
    return client.gridSearch({ levelId: level.id }, onProgress).then((res) => {
      if (`${res.levelId}:${res.configHash}` !== key) {
        // The worker's level table differs from the main thread's: still usable, but say so.
        log.warn(`grid result key ${res.levelId}:${res.configHash} ≠ ${key}`);
      }
      log.info(
        `grid ${key}: live search, ${res.evaluated} setups in ${res.ms.toFixed(0)} ms ` +
          `(${(performance.now() - t0).toFixed(0)} ms round trip)`,
      );
      return res;
    });
  };
  const p = (usePrecomputed ? precomputedGrid(key) : Promise.resolve(null)).then((hit) => {
    if (!hit) return live();
    log.info(`grid ${key}: precomputed target (search took ${hit.ms.toFixed(0)} ms at build time)`);
    onProgress?.(1);
    return hit;
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

let usePrecomputed = true;

/** Tests and the dev worker page: force (or allow) the live search. */
export function setUsePrecomputed(on: boolean): void {
  usePrecomputed = on;
}

/** Tests. */
export function clearGridCache(): void {
  cache.clear();
}
