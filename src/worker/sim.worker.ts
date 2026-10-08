/**
 * Sim worker: `ping`, `run`, `gridSearch` (contract 05). Bundled as a classic IIFE (see
 * `vite.shared.ts`), so no dynamic `import()` here.
 *
 * Wire format: requests `{ id, type, payload }`; progress `{ id, progress }`; replies
 * `{ id, ok: true, value }` (with a transfer list) or `{ id, ok: false, error }`.
 */
import { attachHandlers, type WorkerScope } from './dispatch';
import { handlers } from './handlers';

attachHandlers(self as unknown as WorkerScope, handlers);
