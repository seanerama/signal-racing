/**
 * The ONLY place that differs between `build` and `build:single`: `@sim-worker` resolves to a
 * separate worker chunk normally, and to an inlined (blob/data URL) worker in the single-file
 * build so `signal.html` works from `file://`. See `vite.shared.ts`.
 */
import SimWorker from '@sim-worker';

export function spawnSimWorker(): Worker {
  return new SimWorker({ name: 'signal-sim' });
}
