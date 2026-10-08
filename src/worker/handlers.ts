/**
 * Worker-side RPC handlers, free of any worker global so Node tests can call them directly
 * (and `tests/worker/adapter.ts` can run the whole RPC in process). `sim.worker.ts` wires them
 * to `postMessage`.
 *
 * The main thread sends only ids and setups; levels are resolved here from `LEVELS`.
 */
import { simulate, SimInputError } from '@/engine/index';
import type { PhysicalColumns } from '@/engine/types';
import { gridSearch } from '@/game/grid-search';
import { LEVELS } from '@/levels/index';
import type { LevelConfig, LevelId } from '@/levels/types';
import { buildSimInput } from './build-input';
import type { RpcMethods, RpcType } from './types';

/** What a handler may do besides returning: report progress and name buffers to transfer. */
export interface HandlerCtx {
  progress(frac: number): void;
  /** Buffers to move (not copy) with the reply. */
  transfer: Transferable[];
}

export type Handlers = {
  [T in RpcType]: (
    payload: RpcMethods[T]['req'],
    ctx: HandlerCtx,
  ) => RpcMethods[T]['res'] | Promise<RpcMethods[T]['res']>;
};

export function resolveLevel(levelId: LevelId): LevelConfig {
  const level = LEVELS.find((l) => l.id === levelId);
  if (!level) throw new SimInputError('levelId', `unknown level ${String(levelId)}`);
  return level;
}

/** Every distinct ArrayBuffer behind a run's columns. */
export function columnBuffers(c: PhysicalColumns): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  for (const a of [c.t, c.s, c.seg, ...Object.values(c.ch)]) {
    if (a.buffer instanceof ArrayBuffer) set.add(a.buffer);
  }
  return [...set];
}

export const handlers: Handlers = {
  ping: (payload) => ({ reply: 'pong', sentAt: payload.sentAt }),

  run: ({ levelId, setup, runIndex }, ctx) => {
    if (!Number.isInteger(runIndex) || runIndex < 1) {
      throw new SimInputError('runIndex', `must be a positive integer (got ${runIndex})`);
    }
    const level = resolveLevel(levelId);
    const input = buildSimInput(level, setup, runIndex);
    const { outcome, columns } = simulate(input, 'full');
    if (!columns) throw new Error('full simulation returned no columns');
    ctx.transfer.push(...columnBuffers(columns));
    return { seed: input.seed, conditions: input.conditions, outcome, physical: columns };
  },

  gridSearch: ({ levelId }, ctx) =>
    gridSearch(resolveLevel(levelId), { onProgress: (f) => ctx.progress(f) }),
};
