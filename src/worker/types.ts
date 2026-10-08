/**
 * Sim worker RPC types (contract 05). Written by Stage 1; Stage 5 implements `createSimClient()`
 * and the worker handlers. FROZEN after Stage 1 (the RPC method map may grow).
 */
import type { Conditions, Outcome, PhysicalColumns, Setup } from '@/engine/types';
import type { LevelId } from '@/levels/types';

/** Result of one player run. */
export interface RunPayload {
  /**
   * ALWAYS per run: `hash(levelId, runIndex)` (contract 05, amended after Stage 3). It drives the
   * telemetry noise and distractors every run; physics condition variation applies only when the
   * level declares `conditions.variation`.
   */
  seed: number;
  /** After variation, so the player can see it. */
  conditions: Conditions;
  outcome: Outcome;
  /** Transferred (ArrayBuffers in the transfer list, no copy). */
  physical: PhysicalColumns;
}

/** Result of the level-load grid search. */
export interface GridResult {
  levelId: LevelId;
  /** Stable hash of the level's track, levers, flags and car. */
  configHash: string;
  optimum: { setup: Setup; outcome: Outcome };
  /** s: `optimum.totalTime × (1 + tolerance)`. */
  target: number;
  /** s, per segment: min over all evaluated setups of that segment's time. */
  segmentFloors: number[];
  /** Every evaluated point (response-surface input). */
  samples: Array<{ setup: Setup; totalTime: number }>;
  evaluated: number;
  /** Wall-clock duration of the search. */
  ms: number;
}

export interface RunRequest {
  levelId: LevelId;
  setup: Setup;
  /** 1-based within the level session. */
  runIndex: number;
}

export interface GridSearchRequest {
  levelId: LevelId;
}

/**
 * The only way the UI reaches the engine. `createSimClient()` in `src/worker/client.ts` (Stage 5)
 * spins up `src/worker/sim.worker.ts` (a module worker; inlined in `build:single`).
 *
 * Errors: rejected promises carry a reconstructed `SimInputError` / `SimDivergedError` (same class
 * names and fields, contract 02). Unknown errors become `Error` with `name = 'WorkerError'`.
 */
export interface SimClient {
  run(req: RunRequest): Promise<RunPayload>;
  gridSearch(req: GridSearchRequest, onProgress?: (frac: number) => void): Promise<GridResult>;
  dispose(): void;
}

// ---- Wire envelope (main ↔ worker) ----

/** RPC method map: `type` → request payload and response value. */
export interface RpcMethods {
  ping: { req: { sentAt: number }; res: { reply: 'pong'; sentAt: number } };
  run: { req: RunRequest; res: RunPayload };
  gridSearch: { req: GridSearchRequest; res: GridResult };
}

export type RpcType = keyof RpcMethods;

/** Main → worker. */
export interface RpcRequest<T extends RpcType = RpcType> {
  id: number;
  type: T;
  payload: RpcMethods[T]['req'];
}

/** A serialised error. `detail` carries typed-error fields (e.g. `field`, `step`, `state`). */
export interface RpcError {
  name: string;
  message: string;
  detail?: Record<string, unknown>;
}

/** Worker → main: the final reply to request `id`. */
export type RpcResponse<T extends RpcType = RpcType> =
  | { id: number; ok: true; value: RpcMethods[T]['res'] }
  | { id: number; ok: false; error: RpcError };

/** Worker → main: a progress event for request `id` (grid search; at most every 50 ms). */
export interface RpcProgress {
  id: number;
  progress: number;
}

export type RpcMessageFromWorker = RpcResponse | RpcProgress;
