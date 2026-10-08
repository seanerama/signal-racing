/**
 * Dev listing of the channel registry, grouped, for review by the Vision Lead.
 *
 *   npx tsx scripts/channels.ts            # table: id, unit (metric / imperial), family, range, noise
 *   npx tsx scripts/channels.ts --summary  # counts by group and family only
 */
import { allChannels, channelRange, GROUP_ORDER } from '@/telemetry/registry';
import type { ChannelDef } from '@/telemetry/types';
import { unitLabel } from '@/units';

const summaryOnly = process.argv.includes('--summary');

const family = (c: ChannelDef): string =>
  c.source.kind === 'distractor' ? c.source.family : c.source.kind;
const unit = (c: ChannelDef): string => {
  const m = unitLabel(c.quantity, 'metric') || '-';
  const i = unitLabel(c.quantity, 'imperial') || '-';
  return m === i ? m : `${m}/${i}`;
};
const num = (v: number): string =>
  Math.abs(v) >= 1000 ? v.toExponential(1) : String(+v.toPrecision(4));

const all = allChannels();
const lines: string[] = [];
const byFamily = new Map<string, number>();
for (const c of all) byFamily.set(family(c), (byFamily.get(family(c)) ?? 0) + 1);

lines.push(`Signal channel registry: ${all.length} channels`);
lines.push(
  'by family: ' +
    [...byFamily]
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${f} ${n}`)
      .join(', '),
);

for (const g of GROUP_ORDER) {
  const rows = all.filter((c) => c.group === g);
  if (rows.length === 0) continue;
  lines.push('', `## ${g} (${rows.length})`);
  if (summaryOnly) continue;
  for (const c of rows) {
    const [lo, hi] = channelRange(c.id);
    const noise = c.noise.sigmaFrac === 0 ? 'exact' : `σ${(c.noise.sigmaFrac * 100).toFixed(1)}%`;
    lines.push(
      [
        c.id.padEnd(26),
        c.quantity.padEnd(13),
        unit(c).padEnd(10),
        family(c).padEnd(13),
        `${num(lo)}..${num(hi)}`.padEnd(18),
        noise,
      ].join(' '),
    );
  }
}

console.log(lines.join('\n'));
