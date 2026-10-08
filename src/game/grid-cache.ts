/**
 * Main-thread grid-search cache (contract 05): in memory, keyed by `${levelId}:${configHash}`.
 * The search itself always runs in the worker via the `SimClient`. A failed search is evicted
 * so the next call retries.
 */
import { log } from '@/app/log';
import type { LevelConfig } from '@/levels/types';
import type { GridResult, SimClient } from '@/worker/types';
import { gridKey } from './config-hash';

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
  const p = client.gridSearch({ levelId: level.id }, onProgress).then((res) => {
    if (`${res.levelId}:${res.configHash}` !== key) {
      // The worker's level table differs from the main thread's: still usable, but say so.
      log.warn(`grid result key ${res.levelId}:${res.configHash} ≠ ${key}`);
    }
    return res;
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** Tests. */
export function clearGridCache(): void {
  cache.clear();
}
