/**
 * Export CSV (signal.md "Export"; design-system Buttons: secondary). Builds the run's CSV with
 * `toCsv` (contract 03; one column per channel in the level set, a units row in the display
 * system) and downloads it as `signal_<level>_run<n>.csv`. Works from `file://` (Blob URL +
 * `download`), with no network.
 */
import { useEffect, useState } from 'preact/hooks';
import type { Setup } from '@/engine/types';
import { toCsv } from '@/export/csv';
import type { RunTelemetry } from '@/telemetry/types';
import type { UnitSystem } from '@/units';
import { Button } from '@/app/components/Button';
import { announce } from './a11y';

export interface CsvButtonProps {
  levelId: string;
  run: { index: number; seed: number; setup: Setup; telemetry: RunTelemetry };
  units: UnitSystem;
}

export function csvFileName(levelId: string, run: number): string {
  return `signal_${levelId}_run${run}.csv`;
}

/** Hands `text` to the browser as a file download. */
export function downloadText(text: string, fileName: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function CsvButton({ levelId, run, units }: CsvButtonProps) {
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [run.index]);
  const name = csvFileName(levelId, run.index);
  return (
    <Button
      variant="secondary"
      size="compact"
      data-testid="csv-button"
      title={`${run.telemetry.channelIds.length} channels, one column each: ${name}`}
      onClick={() => {
        const text = toCsv(run.telemetry, {
          levelId,
          run: run.index,
          seed: run.seed,
          setup: run.setup,
          units,
        });
        downloadText(text, name);
        setSaved(true);
        announce(`CSV saved: ${name}`);
      }}
    >
      {saved ? 'CSV saved' : 'Export CSV'}
    </Button>
  );
}
