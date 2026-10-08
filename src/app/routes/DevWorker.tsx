import { useEffect, useRef, useState } from 'preact/hooks';
import { log } from '@/app/log';
import { createWorkerRpc, type WorkerRpc } from '@/worker/client';
import { Button } from '../components/Button';

type Status =
  | { kind: 'pinging' }
  | { kind: 'ok'; reply: string; rttMs: number }
  | { kind: 'error'; message: string };

/**
 * `/#/dev/worker`: pings the sim worker and shows the round-trip time. Proves the worker loads
 * under `vite dev`, `vite build` and the single-file build from `file://`.
 */
export function DevWorker() {
  const rpc = useRef<WorkerRpc | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'pinging' });

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
    </section>
  );
}
