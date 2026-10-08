/**
 * Dev-only: grid optimum of a level under CAR overrides, with the weight profile and lock times.
 *   CAR='{"brakeBiasFront":0.7}' npx tsx scripts/probe-grid.ts A3
 */
import { simulate } from '../src/engine/index';
import type { CarParams, Setup } from '../src/engine/types';
import { gridSearch } from '../src/game/grid-search';
import { getLevel } from '../src/levels/index';
import type { LevelConfig } from '../src/levels/types';
import { buildBaseSimInput } from '../src/worker/build-input';

const variants = JSON.parse(
  process.env.CARS ?? `[${process.env.CAR ?? '{}'}]`,
) as Partial<CarParams>[];
for (const over of variants) {
  const id = process.argv[2] ?? 'A3';
  const base = getLevel(id)!;
  const extra = JSON.parse(process.env.LEVEL ?? '{}') as Partial<LevelConfig>;
  const level: LevelConfig = { ...base, ...extra, car: { ...base.car, ...over } };

  function locks(setup: Partial<Setup>) {
    const r = simulate(buildBaseSimInput(level, setup), 'full');
    const ch = r.columns!.ch;
    let brakeT = 0,
      fLock = 0,
      rLock = 0,
      rLaunch = 0;
    for (let i = 0; i < r.columns!.t.length; i++) {
      const b = ch.brake![i]! > 0.01;
      const fs = ch.front_slip_ratio![i]!,
        rs = ch.rear_slip_ratio![i]!;
      if (b) {
        brakeT += 0.01;
        if (fs > 0.101) fLock += 0.01;
        if (rs > 0.101) rLock += 0.01;
      } else if (rs > 0.101) rLaunch += 0.01;
    }
    return { t: r.outcome.totalTime, brakeT, fLock, rLock, rLaunch };
  }

  const g = gridSearch(level);
  const opt = g.optimum.setup;
  console.log('car', over, 'level', extra);
  console.log(
    `optimum ${g.optimum.outcome.totalTime.toFixed(3)} target ${g.target.toFixed(3)}`,
    opt,
  );
  const f = (x: number) => x.toFixed(3);
  for (const l of level.levers) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(l.id)) continue;
    console.log(`\n${l.id}: value  t@others-opt  pass  profileBest  brakeT fLock rLock rLaunch`);
    const n = Math.round((l.max - l.min) / l.step);
    for (let i = 0; i <= n; i++) {
      const v = +(l.min + i * l.step).toFixed(3);
      const k = locks({ ...opt, [l.id]: v });
      let prof = Infinity;
      for (const s of g.samples)
        if (Math.abs(s.setup[l.id] - v) < 1e-6) prof = Math.min(prof, s.totalTime);
      console.log(
        `  ${String(v).padEnd(5)} ${f(k.t)}  ${k.t <= g.target ? 'PASS' : '    '}  ${f(prof)}  ${k.brakeT.toFixed(2)} ${k.fLock.toFixed(2)} ${k.rLock.toFixed(2)} ${k.rLaunch.toFixed(2)}`,
      );
    }
  }
  const defaults: Partial<Setup> = {};
  for (const l of level.levers) defaults[l.id] = l.default;
  const d = locks(defaults);
  console.log(
    `\ndefaults ${JSON.stringify(defaults)} → ${f(d.t)} (${d.t <= g.target ? 'PASS' : 'fail'})`,
  );
}
