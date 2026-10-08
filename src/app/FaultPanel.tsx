/**
 * Fault panel (design-system "Fault panel"): a `--raised` block with a 3px `--fault` left border,
 * the error name in mono, the message, seed, setup JSON and **Copy repro**. It replaces the stack
 * (or the whole route, from the error boundary); it is not a toast. A failed run does not consume
 * budget, and the panel says so.
 */
import { useState } from 'preact/hooks';
import { APP_VERSION } from './constants';
import { Button } from './components/Button';
import './screens.css';

export interface FaultInfo {
  error: unknown;
  levelId?: string;
  runIndex?: number;
  seed?: number | null;
  setup?: unknown;
  /** Where it happened, e.g. 'run' or 'render'. */
  context: string;
}

function describe(err: unknown): {
  name: string;
  message: string;
  detail: Record<string, unknown>;
} {
  if (err instanceof Error) {
    const detail: Record<string, unknown> = {};
    for (const k of Object.keys(err)) detail[k] = (err as unknown as Record<string, unknown>)[k];
    return { name: err.name || 'Error', message: err.message, detail };
  }
  return { name: 'Error', message: String(err), detail: {} };
}

export function reproText(f: FaultInfo): string {
  const d = describe(f.error);
  return JSON.stringify(
    {
      app: `signal ${APP_VERSION}`,
      context: f.context,
      level: f.levelId ?? null,
      run: f.runIndex ?? null,
      seed: f.seed ?? null,
      setup: f.setup ?? null,
      error: { name: d.name, message: d.message, ...d.detail },
    },
    null,
    2,
  );
}

export interface FaultPanelProps {
  fault: FaultInfo;
  onDismiss?(): void;
  dismissLabel?: string;
}

export function FaultPanel({ fault, onDismiss, dismissLabel = 'Dismiss' }: FaultPanelProps) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const d = describe(fault.error);
  const repro = reproText(fault);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(repro);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };
  return (
    <section class="fault" role="alert" data-testid="fault-panel">
      <div class="fault__name mono">{d.name}</div>
      <p class="fault__msg">{d.message}</p>
      {fault.context === 'run' && (
        <p class="fault__note dim">
          The engine stopped on this run. It did not count against the run budget.
        </p>
      )}
      <dl class="fault__kv data">
        {fault.levelId && (
          <>
            <dt class="dim">level</dt>
            <dd>{fault.levelId}</dd>
          </>
        )}
        <dt class="dim">seed</dt>
        <dd data-testid="fault-seed">{fault.seed ?? '—'}</dd>
      </dl>
      {fault.setup !== undefined && (
        <pre class="fault__setup data">{JSON.stringify(fault.setup, null, 2)}</pre>
      )}
      <div class="fault__actions">
        <Button variant="secondary" onClick={() => void copy()} data-testid="copy-repro">
          Copy repro
        </Button>
        {onDismiss && (
          <Button variant="ghost" onClick={onDismiss}>
            {dismissLabel}
          </Button>
        )}
        <span class="micro dim" aria-live="polite">
          {copied === 'ok'
            ? 'Copied.'
            : copied === 'fail'
              ? 'Clipboard blocked; the repro is below.'
              : ''}
        </span>
      </div>
      {copied === 'fail' && (
        <textarea class="fault__repro data" readOnly value={repro} rows={8} aria-label="Repro" />
      )}
    </section>
  );
}
