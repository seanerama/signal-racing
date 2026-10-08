/**
 * CSV export (contract 03). Stage 3 owns the string; Stage 8 owns the download UI.
 *
 * ```
 * # signal v0.3
 * "# Independent educational prototype. Not affiliated …"   ← v0.3 (Stage 9): the disclaimer, one cell
 * # level: A2
 * # run: 3
 * # seed: 12345
 * # units: metric
 * "# setup: {""throttle_ramp"":0.4,…}"   ← one RFC 4180-quoted cell (v0.2; v0.1 left it bare)
 * t,s,speed,…            ← header: t, s, then every channel of the level set in registry order
 * s,m,km/h,…             ← units row in the display system ('' for unitless quantities)
 * 0.000,0.0,0.0,…        ← one row per sample, formatted with precision() from contract 01
 * ```
 * Values are converted to the selected unit system. NaN dropouts are empty cells; ±Infinity is
 * written as `inf` / `-inf`.
 */
import type { Quantity } from '@/engine/types';
import { DISCLAIMER } from '@/game/disclaimer';
import { getChannel } from '@/telemetry/registry';
import type { CsvMeta, RunTelemetry } from '@/telemetry/types';
import { precision, toDisplay, unitLabel, type UnitSystem } from '@/units';

export const CSV_FORMAT_VERSION = 'v0.3';

/** Quotes a header/units cell if it holds a comma, quote or newline (RFC 4180). */
function cell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One value formatter per column. */
function formatter(q: Quantity, sys: UnitSystem): (si: number) => string {
  const dp = precision(q, sys);
  return (si) => {
    if (Number.isNaN(si)) return '';
    if (!Number.isFinite(si)) return si > 0 ? 'inf' : '-inf';
    const s = toDisplay(q, sys, si).toFixed(dp);
    // Never write negative zero ("-0.0").
    return s.charCodeAt(0) === 45 && /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
  };
}

export function toCsv(rt: RunTelemetry, meta: CsvMeta): string {
  const sys = meta.units;
  const ids = rt.channelIds;
  const quantities: Quantity[] = ['time', 'distance', ...ids.map((id) => getChannel(id).quantity)];
  const columns: Float32Array[] = [rt.t, rt.s, ...ids.map((id) => rt.get(id))];
  const fmts = quantities.map((q) => formatter(q, sys));

  const lines: string[] = [
    `# signal ${CSV_FORMAT_VERSION}`,
    // Stage 9: the disclaimer travels with every exported log. A comma would split the comment
    // across spreadsheet columns, so it is one quoted cell like the setup line.
    cell(`# ${DISCLAIMER}`),
    `# level: ${meta.levelId}`,
    `# run: ${meta.run}`,
    `# seed: ${meta.seed}`,
    `# units: ${sys}`,
    // One quoted cell: the JSON's commas and quotes must not split across spreadsheet columns.
    cell(`# setup: ${JSON.stringify(meta.setup)}`),
    ['t', 's', ...ids].map(cell).join(','),
    quantities.map((q) => cell(unitLabel(q, sys))).join(','),
  ];

  const nCol = columns.length;
  const row: string[] = new Array<string>(nCol);
  for (let i = 0; i < rt.n; i++) {
    for (let c = 0; c < nCol; c++) row[c] = fmts[c]!(columns[c]![i]!);
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}
