/**
 * `@sim-worker` is a build-time alias (see `vite.shared.ts`) for `./sim.worker.ts?worker`
 * (standard build) or `./sim.worker.ts?worker&inline` (single-file build).
 */
declare module '@sim-worker' {
  const SimWorker: new (options?: { name?: string }) => Worker;
  export default SimWorker;
}
