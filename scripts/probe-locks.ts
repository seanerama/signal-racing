/**
 * Dev-only: where an axle slides on a run (per segment, drive vs braking).
 *   SETUP='{"weight_dist":0.46}' npx tsx scripts/probe-locks.ts B4L
 */
import { simulate } from '../src/engine/index';
import type { Setup } from '../src/engine/types';
import { getLevel } from '../src/levels/index';
import { buildBaseSimInput } from '../src/worker/build-input';

const level = getLevel(process.argv[2] ?? 'B4L')!;
const setup = JSON.parse(process.env.SETUP ?? '{}') as Partial<Setup>;
const r = simulate(buildBaseSimInput(level, setup), 'full');
const c = r.columns!;
const ch = c.ch;
console.log(
  level.id,
  JSON.stringify(buildBaseSimInput(level, setup).setup),
  r.outcome.totalTime.toFixed(3),
);
let firstBrake = -1;
let lastBrake = -1;
const rows = new Map<string, number>();
for (let i = 0; i < c.t.length; i++) {
  const b = ch.brake![i]! > 0.01;
  if (b) {
    if (firstBrake < 0) firstBrake = c.t[i]!;
    lastBrake = c.t[i]!;
  }
  const seg = level.track.segments[c.seg[i]!]!.label;
  for (const [axle, id] of [
    ['front', 'front_slip_ratio'],
    ['rear', 'rear_slip_ratio'],
  ] as const) {
    if (ch[id]![i]! > 0.101) {
      const k = `${seg} ${axle} ${b ? 'braking' : 'drive'}`;
      rows.set(k, (rows.get(k) ?? 0) + 0.01);
    }
  }
}
for (const [k, v] of rows) console.log(`  ${k}: ${v.toFixed(2)} s`);
console.log(`  brake window ${firstBrake.toFixed(2)}–${lastBrake.toFixed(2)} s`);
