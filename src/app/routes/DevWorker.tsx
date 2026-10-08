import { useEffect, useRef, useState } from 'preact/hooks';
import { log } from '@/app/log';
import { getProgress, recordResult, scoreOf } from '@/game/progress';
import { startLevel } from '@/game/session';
import { getLevel } from '@/levels/index';
import { createSimClient, createWorkerRpc, type WorkerRpc } from '@/worker/client';
import { Button } from '../components/Button';

type Status =
  | { kind: 'pinging' }
  | { kind: 'ok'; reply: string; rttMs: number }
  | { kind: 'error'; message: string };

/**
 * The Stage 5 pipeline in the browser: `createSimClient()` → `gridSearch('A2')` →
 * `run(optimum.setup)` → `startLevel` session flow → `recordResult`. Returns a JSON-able report.
 */
async function runPipeline(): Promise<Record<string, unknown>> {
  const level = getLevel('A2');
  if (!level) throw new Error('level A2 missing');
  const client = createSimClient();
  try {
    const t0 = performance.now();
    const grid = await client.gridSearch({ levelId: 'A2' });
    const gridWallMs = performance.now() - t0;
    log.debug(
      `dev pipeline: grid A2 ${grid.ms.toFixed(1)} ms in worker, ${gridWallMs.toFixed(1)} ms wall`,
    );
    const direct = await client.run({ levelId: 'A2', setup: grid.optimum.setup, runIndex: 1 });
    const session = startLevel(level, client);
    const rec = await session.run(grid.optimum.setup);
    recordResult('A2', session);
    return {
      grid: {
        ms: Number(grid.ms.toFixed(1)),
        wallMs: Number(gridWallMs.toFixed(1)),
        evaluated: grid.evaluated,
        target: grid.target,
        optimum: { setup: grid.optimum.setup, totalTime: grid.optimum.outcome.totalTime },
      },
      directRun: { totalTime: direct.outcome.totalTime, seed: direct.seed, n: direct.physical.n },
      session: {
        runTime: rec.outcome.totalTime,
        passes: rec.outcome.totalTime <= grid.target,
        status: session.status.value,
        score: scoreOf(session),
        runsUsed: session.runsUsed.value,
        hints: rec.hints.map((h) => h.ruleId),
      },
      progress: getProgress().A2 ?? null,
    };
  } finally {
    client.dispose();
  }
}

/**
 * `/#/dev/worker`: pings the sim worker and shows the round-trip time. Proves the worker loads
 * under `vite dev`, `vite build` and the single-file build from `file://`. The "grid A2 + run
 * optimum" button runs the Stage 5 pipeline and prints its JSON.
 */
export function DevWorker() {
  const rpc = useRef<WorkerRpc | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'pinging' });
  const [pipeline, setPipeline] = useState<
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'done'; json: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const pipelineRun = async () => {
    setPipeline({ kind: 'running' });
    try {
      const report = await runPipeline();
      setPipeline({ kind: 'done', json: JSON.stringify(report, null, 2) });
    } catch (err) {
      log.error('dev pipeline failed', err);
      setPipeline({
        kind: 'error',
        message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  };

  const ping = async () => {
    setStatus({ kind: 'pinging' });
    try {
      rpc.current ??= createWorkerRpc();
      const res = await rpc.current.ping();
      setStatus({ kind: 'ok', reply: res.reply, rttMs: res.rttMs });
    } catch (err) {
      log.error('worker ping failed', err);
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    void ping();
    return () => {
      rpc.current?.dispose();
      rpc.current = null;
    };
  }, []);

  return (
    <section class="dev-page">
      <h1 class="h2 dim">Dev · Sim worker</h1>
      <dl class="dev-kv data">
        <dt class="dim">status</dt>
        <dd data-testid="worker-status" role="status" aria-live="polite">
          {status.kind === 'pinging' && 'pinging…'}
          {status.kind === 'ok' && status.reply}
          {status.kind === 'error' && <span class="dev-fault">{status.message}</span>}
        </dd>
        <dt class="dim">round trip</dt>
        <dd data-testid="worker-rtt">
          {status.kind === 'ok' ? `${status.rttMs.toFixed(2)} ms` : '—'}
        </dd>
      </dl>
      <Button onClick={() => void ping()} busy={status.kind === 'pinging'} busyLabel="Pinging">
        Ping again
      </Button>
      <Button
        onClick={() => void pipelineRun()}
        busy={pipeline.kind === 'running'}
        busyLabel="Running"
      >
        grid A2 + run optimum
      </Button>
      {pipeline.kind === 'done' && (
        <pre class="data" data-testid="worker-pipeline">
          {pipeline.json}
        </pre>
      )}
      {pipeline.kind === 'error' && (
        <p class="dev-fault" data-testid="worker-pipeline-error">
          {pipeline.message}
        </p>
      )}
    </section>
  );
}
