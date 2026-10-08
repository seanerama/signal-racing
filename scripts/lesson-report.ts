/**
 * Dev-only: the numbers behind the Stage 11 lesson fixes (signal-to-noise per level, A3 weights
 * passing, the A2 pressure sweep, B4L over varied seeds).
 *
 *   npx tsx scripts/lesson-report.ts
 */
import { simulate } from '../src/engine/index';
import type { Setup } from '../src/engine/types';
import { A2, A3, B4L, LEVELS } from '../src/levels/index';
import type { LevelConfig } from '../src/levels/types';
import { buildBaseSimInput, buildSimInput } from '../src/worker/build-input';
import { gridFor } from '../tests/levels/hint-bot';

const steps = (min: number, max: number, step: number): number[] =>
  Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => +(min + i * step).toFixed(3),
  );
const time = (level: LevelConfig, s: Partial<Setup>): number =>
  simulate(buildBaseSimInput(level, s), 'fast').outcome.totalTime;

console.log('## Signal-to-noise (total : causal)');
for (const l of LEVELS) {
  const causal = l.channelSet.filter((id) => l.channelRoles[id] === 'causal');
  console.log(
    `${l.id.padEnd(4)} ${String(l.channelSet.length).padStart(3)} / ${causal.length} = 1 in ${(l.channelSet.length / causal.length).toFixed(1)}  (${causal.join(', ')})`,
  );
}

console.log('\n## A3 weight values passing');
const g3 = gridFor(A3);
const opt3 = g3.optimum.setup;
const def3 = Object.fromEntries(A3.levers.map((l) => [l.id, l.default])) as Partial<Setup>;
console.log(`target ${g3.target.toFixed(3)} (optimum ${g3.optimum.outcome.totalTime.toFixed(3)})`);
for (const wd of steps(0.38, 0.52, 0.02)) {
  const a = time(A3, {
    throttle_ramp: opt3.throttle_ramp,
    tire_pressure: opt3.tire_pressure,
    weight_dist: wd,
  });
  const b = time(A3, { ...def3, weight_dist: wd });
  console.log(
    `wd ${wd.toFixed(2)}  at optimum ramp/pressure ${a.toFixed(3)} ${a <= g3.target ? 'PASS' : '    '}   at defaults ${b.toFixed(3)} ${b <= g3.target ? 'PASS' : ''}`,
  );
}

console.log('\n## A2 pressure sweep');
const g2 = gridFor(A2);
console.log(`target ${g2.target.toFixed(3)}`);
for (const p of steps(1.2, 2.2, 0.1)) {
  const at = time(A2, { throttle_ramp: 0.2, tire_pressure: p });
  let best = Infinity;
  let bestR = 0;
  for (const r of steps(0, 3, 0.2)) {
    const t = time(A2, { throttle_ramp: r, tire_pressure: p });
    if (t < best) [best, bestR] = [t, r];
  }
  console.log(
    `p ${p.toFixed(1)}  ramp 0.2: ${at.toFixed(3)}   best ramp ${bestR.toFixed(1)}: ${best.toFixed(3)}`,
  );
}

console.log('\n## B4L optimum over 10 varied seeds');
const g4 = gridFor(B4L);
let n = 0;
const ts: string[] = [];
for (let run = 1; run <= 10; run++) {
  const t = simulate(buildSimInput(B4L, g4.optimum.setup, run), 'fast').outcome.totalTime;
  ts.push(t.toFixed(3));
  if (t <= g4.target) n++;
}
console.log(`${n}/10 pass (target ${g4.target.toFixed(3)}): ${ts.join(' ')}`);
