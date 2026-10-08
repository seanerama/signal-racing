/**
 * Contract 05 validation: pipeline, zero-copy transfer, typed errors. Runs through the real
 * worker message loop and handlers via the in-process adapter (`./adapter.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimDivergedError, SimInputError } from '@/engine/errors';
import { columnBuffers, handlers } from '@/worker/handlers';
import { createSimClient, createWorkerRpc } from '@/worker/client';
import type { Setup } from '@/engine/types';
import type { RunPayload, SimClient } from '@/worker/types';
import { createInProcessWorker } from './adapter';
import { gridSize } from '@/game/grid-search';
import { A2 } from '@/levels/index';

vi.setConfig({ testTimeout: 60_000 });

const BASE: Setup = { throttle_ramp: 0, tire_pressure: 1.6, weight_dist: 0.45, wing: 4 };

let client: SimClient | null = null;
afterEach(() => {
  client?.dispose();
  client = null;
});

describe('sim client over the worker loop', () => {
  it('pipeline: gridSearch(A2) → run(optimum) → totalTime ≤ target', async () => {
    client = createSimClient(createInProcessWorker());
    const progress: number[] = [];
    const grid = await client.gridSearch({ levelId: 'A2' }, (f) => progress.push(f));
    expect(grid.levelId).toBe('A2');
    expect(grid.evaluated).toBe(gridSize(A2));
    expect(grid.samples).toHaveLength(grid.evaluated);
    expect(progress.at(-1)).toBe(1);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);

    const run = await client.run({ levelId: 'A2', setup: grid.optimum.setup, runIndex: 1 });
    expect(run.outcome.finished).toBe(true);
    expect(run.outcome.totalTime).toBeLessThanOrEqual(grid.target);
    // No variation on A2: physics identical to the grid search's evaluation of the optimum.
    expect(run.outcome.totalTime).toBe(grid.optimum.outcome.totalTime);
    expect(run.physical.n).toBeGreaterThan(100);
    expect(run.physical.ch.speed).toBeInstanceOf(Float32Array);
  });

  it('transfer: after run, the worker-side column buffers are detached (moved, not copied)', async () => {
    const worker = createInProcessWorker();
    client = createSimClient(worker);
    const res = await client.run({
      levelId: 'A2',
      setup: { ...BASE, throttle_ramp: 0.3 },
      runIndex: 1,
    });
    const reply = worker.posted.at(-1)!;
    const sent = (reply.message as { value: RunPayload }).value.physical;
    expect(reply.transfer.length).toBe(columnBuffers(sent).length);
    expect(reply.transfer.length).toBeGreaterThan(3);
    // Worker side: every buffer detached.
    for (const buf of columnBuffers(sent)) expect(buf.byteLength).toBe(0);
    expect(sent.t.length).toBe(0);
    expect(sent.ch.speed!.length).toBe(0);
    // Main side: intact.
    expect(res.physical.t.length).toBe(res.physical.n);
    expect(res.physical.ch.speed!.length).toBe(res.physical.n);
  });

  it('an invalid setup rejects with a reconstructed SimInputError carrying field', async () => {
    client = createSimClient(createInProcessWorker());
    const err: unknown = await client
      .run({ levelId: 'A2', setup: { ...BASE, throttle_ramp: 9 }, runIndex: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimInputError);
    expect((err as SimInputError).name).toBe('SimInputError');
    expect((err as SimInputError).field).toBe('setup.throttle_ramp');
    expect((err as SimInputError).message).toMatch(/^setup\.throttle_ramp: must be in/);
  });

  it('an unknown level rejects with SimInputError(field = levelId)', async () => {
    client = createSimClient(createInProcessWorker());
    const err = await client.gridSearch({ levelId: 'B4L' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimInputError);
    expect((err as SimInputError).field).toBe('levelId');
  });

  it('SimDivergedError comes back with step and state', async () => {
    const worker = createInProcessWorker({
      ...handlers,
      run: () => {
        throw new SimDivergedError(42, { v: NaN, s: 3 });
      },
    });
    client = createSimClient(worker);
    const err = await client
      .run({ levelId: 'A2', setup: {} as never, runIndex: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimDivergedError);
    expect((err as SimDivergedError).step).toBe(42);
    expect((err as SimDivergedError).state.s).toBe(3);
    expect((err as SimDivergedError).message).toBe('simulation diverged at step 42');
  });

  it('untyped errors become WorkerError', async () => {
    const worker = createInProcessWorker({
      ...handlers,
      run: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'boom';
      },
    });
    client = createSimClient(worker);
    const err = await client
      .run({ levelId: 'A2', setup: {} as never, runIndex: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('WorkerError');
  });

  it('request ids keep concurrent replies apart; ping still works', async () => {
    const rpc = createWorkerRpc(createInProcessWorker());
    const [a, b, pong] = await Promise.all([
      rpc.request('run', { levelId: 'A2', setup: { ...BASE, throttle_ramp: 0 }, runIndex: 1 }),
      rpc.request('run', { levelId: 'A2', setup: { ...BASE, throttle_ramp: 1.5 }, runIndex: 2 }),
      rpc.ping(),
    ]);
    expect(a.outcome.totalTime).not.toBe(b.outcome.totalTime);
    expect(a.seed).not.toBe(b.seed);
    expect(pong.reply).toBe('pong');
    rpc.dispose();
  });

  it('dispose rejects pending requests with WorkerError', async () => {
    client = createSimClient(createInProcessWorker());
    const p = client.gridSearch({ levelId: 'A2' });
    client.dispose();
    client = null;
    await expect(p).rejects.toMatchObject({ name: 'WorkerError' });
  });
});
