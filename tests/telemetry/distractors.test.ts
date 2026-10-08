/**
 * Distractor honesty. Fixture traces with varied throttle/speed shapes stand in for setups
 * (Stage 2 is not merged yet); the property under test is that non-echo distractors carry no
 * information about the outcome, and that the echo families do correlate with the driving.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng';
import type { PhysicalColumns } from '@/engine/types';
import { DISTRACTOR_FAMILIES, ECHO_FAMILIES, generateDistractor } from '@/telemetry/distractors';
import { allChannels, getChannel } from '@/telemetry/registry';
import { createRunTelemetry } from '@/telemetry/run-telemetry';
import { channelStats } from '@/telemetry/summary';
import type { ChannelDef, DistractorFamily } from '@/telemetry/types';
import { CORNER_TRACK, corr, makeFixture, std, totalTime } from './fixtures';

const distractors = allChannels().filter(
  (
    c,
  ): c is ChannelDef & {
    source: { kind: 'distractor'; family: DistractorFamily; params: Record<string, number> };
  } => c.source.kind === 'distractor',
);
const isEcho = (c: (typeof distractors)[number]) => ECHO_FAMILIES.includes(c.source.family);
const nonEcho = distractors.filter((c) => !isEcho(c));
const echoes = distractors.filter(isEcho);

/** 20 "setups": different launch ramps, power, grip (corner speed) on the corner track. */
function setups(count: number): PhysicalColumns[] {
  const rng = createRng(20261008);
  return Array.from({ length: count }, () =>
    makeFixture({
      segments: CORNER_TRACK.map((s) =>
        s.kind === 'corner' ? { ...s, vlim: 28 + 8 * rng.next() } : s,
      ),
      rampTime: 1.5 * rng.next(),
      vmax: 65 + 25 * rng.next(),
      accel: 8 + 5 * rng.next(),
    }),
  );
}

const SETUPS = setups(20);
const TOTAL = SETUPS.map(totalTime);

describe('distractor families', () => {
  it('there is a generator for every family, and every family is used', () => {
    const used = new Set(distractors.map((c) => c.source.family));
    for (const f of Object.keys(DISTRACTOR_FAMILIES))
      expect(used.has(f as DistractorFamily), f).toBe(true);
  });

  it('depend only on (t, s, throttle, speed) and the seed: other channels cannot change them', () => {
    const base = SETUPS[0]!;
    // Same t/s/throttle/speed, every other physical channel scrambled.
    const scrambled: PhysicalColumns = { ...base, ch: { ...base.ch } };
    for (const id of Object.keys(scrambled.ch)) {
      if (id === 'throttle' || id === 'speed') continue;
      scrambled.ch[id] = scrambled.ch[id]!.map((v, i) => v * 3 + Math.sin(i));
    }
    const ids = distractors.map((c) => c.id);
    const a = createRunTelemetry({ physical: base, channelIds: ids, seed: 8 });
    const b = createRunTelemetry({ physical: scrambled, channelIds: ids, seed: 8 });
    for (const id of ids) expect([...b.get(id)], id).toEqual([...a.get(id)]);
  });

  it('clean output stays inside the declared sensor range', () => {
    const rt = createRunTelemetry({ physical: SETUPS[1]!, channelIds: [], seed: 4 });
    for (const c of distractors) {
      const { lo, hi } = c.source.params;
      const st = channelStats(rt.getClean(c.id), rt.t);
      expect(st.dropouts, c.id).toBe(0);
      expect(st.min, c.id).toBeGreaterThanOrEqual(Math.fround(lo!) - 1e-6);
      expect(st.max, c.id).toBeLessThanOrEqual(Math.fround(hi!) + 1e-6);
    }
  });

  it('generateDistractor is a pure function of its inputs', () => {
    const pc = SETUPS[2]!;
    const src = getChannel('radio_rssi').source;
    if (src.kind !== 'distractor') throw new Error('expected distractor');
    const run = (seed: number) =>
      generateDistractor(src.family, {
        n: pc.n,
        dt: pc.dt,
        t: pc.t,
        s: pc.s,
        throttle: pc.ch.throttle!,
        speed: pc.ch.speed!,
        rng: createRng(seed).fork('distractor:radio_rssi'),
        params: src.params,
      });
    expect([...run(1)]).toEqual([...run(1)]);
    expect([...run(1)]).not.toEqual([...run(2)]);
  });
});

describe('distractor independence (contract 03 validation)', () => {
  /**
   * Contract: for 20 random setups, |corr(distractor mean, totalTime)| < 0.3 for every non-echo
   * distractor. With only 20 runs a truly independent channel exceeds |r| = 0.3 by chance about
   * one time in five (σ_r ≈ 1/√19 ≈ 0.23), so over 140 channels the literal check would fail on
   * noise alone. Each of the 20 setups is therefore run under 10 run seeds (200 runs, σ_r ≈ 0.07):
   * the same statement, with enough samples for |r| < 0.3 to be a real bound. Means are taken on
   * the clean series: the noise layer is zero-mean and seeded independently of the run.
   */
  it('|corr(run mean, totalTime)| < 0.3 for every non-echo distractor over 20 setups × 10 seeds', () => {
    const SEEDS = 10;
    const means = new Map<string, number[]>(nonEcho.map((c) => [c.id, []]));
    const times: number[] = [];
    SETUPS.forEach((pc, k) => {
      for (let j = 0; j < SEEDS; j++) {
        const rt = createRunTelemetry({ physical: pc, channelIds: [], seed: 1000 * k + j });
        times.push(TOTAL[k]!);
        for (const c of nonEcho) means.get(c.id)!.push(channelStats(rt.getClean(c.id), pc.t).mean);
      }
    });
    const worst = nonEcho
      .map((c) => ({ id: c.id, r: Math.abs(corr(means.get(c.id)!, times)) }))
      .sort((a, b) => b.r - a.r);
    if (process.env.SIGNAL_REPORT) console.log('worst |r|', worst.slice(0, 3));
    expect(worst[0]!.r, `${worst[0]!.id} |r|=${worst[0]!.r.toFixed(3)}`).toBeLessThan(0.3);
  }, 60_000);

  /**
   * The stronger property, at a fixed seed: what the setup does to a non-echo distractor's run
   * mean (spread across 20 setups) is small next to ordinary run-to-run sensor variation (spread
   * across 20 seeds on one setup). Long-run time integration (a warmer oil temp after a slower run)
   * exists but is tiny.
   */
  it('setup influence on non-echo run means is small next to run-to-run variation', () => {
    const ratios: Array<{ id: string; ratio: number }> = [];
    for (const c of nonEcho) {
      const mean = (pc: PhysicalColumns, seed: number) =>
        channelStats(
          createRunTelemetry({ physical: pc, channelIds: [], seed }).getClean(c.id),
          pc.t,
        ).mean;
      const acrossSetups = SETUPS.map((pc) => mean(pc, 99));
      const acrossSeeds = Array.from({ length: 20 }, (_, j) => mean(SETUPS[0]!, 5000 + j));
      ratios.push({ id: c.id, ratio: std(acrossSetups) / std(acrossSeeds) });
    }
    ratios.sort((a, b) => b.ratio - a.ratio);
    if (process.env.SIGNAL_REPORT)
      console.log(
        'worst ratio',
        ratios.slice(0, 3),
        'median',
        ratios[Math.floor(ratios.length / 2)],
      );
    // Rare-event status channels have a little more spread from run length; everything is well under 1.
    expect(ratios[0]!.ratio, `${ratios[0]!.id}`).toBeLessThan(0.75);
    const median = ratios[Math.floor(ratios.length / 2)]!.ratio;
    expect(median).toBeLessThan(0.05);
  }, 60_000);

  it('echo families reach |r| > 0.6 with speed or throttle within a run', () => {
    const pc = SETUPS[3]!;
    const rt = createRunTelemetry({ physical: pc, channelIds: [], seed: 31 });
    for (const c of echoes) {
      const driver = c.source.family === 'speed_echo' ? pc.ch.speed! : pc.ch.throttle!;
      const r = Math.abs(corr(rt.get(c.id), driver));
      expect(r, c.id).toBeGreaterThan(0.6);
    }
  });

  it('echo families do correlate with the outcome across setups (the trap is real)', () => {
    const c = getChannel('pitot_dp_1');
    const means = SETUPS.map(
      (pc, k) =>
        channelStats(createRunTelemetry({ physical: pc, channelIds: [], seed: k }).get(c.id), pc.t)
          .mean,
    );
    expect(Math.abs(corr(means, TOTAL))).toBeGreaterThan(0.3);
  });
});

describe('distractor realism', () => {
  const pc = SETUPS[5]!;
  const rt = createRunTelemetry({ physical: pc, channelIds: [], seed: 12 });
  const stats = (id: string) => channelStats(rt.getClean(id), pc.t);

  it('ranges an engineer would believe', () => {
    const within = (id: string, lo: number, hi: number) => {
      const s = stats(id);
      expect(s.min, id).toBeGreaterThanOrEqual(lo);
      expect(s.max, id).toBeLessThanOrEqual(hi);
    };
    within('oil_temp', 80, 125);
    within('battery_voltage', 13.6, 14.4);
    within('fuel_pressure', 5.8, 6.2);
    within('radio_rssi', -70, -40);
    const alt = stats('gps_altitude');
    expect(alt.max - alt.min).toBeLessThanOrEqual(1.0);
  });

  it('oil temp warms with throttle × time', () => {
    const oil = rt.getClean('oil_temp');
    const head = channelStats(oil.subarray(0, 100), pc.t).mean;
    const tail = channelStats(oil.subarray(pc.n - 300, pc.n - 200), pc.t).mean;
    expect(tail).toBeGreaterThan(head);
  });

  it('periodic channels actually oscillate, walks wander, flats stay flat', () => {
    expect(std(rt.getClean('radio_rssi')) / 30).toBeGreaterThan(0.05);
    expect(std(rt.getClean('gps_altitude'))).toBeGreaterThan(0.02);
    expect(std(rt.getClean('fuel_pressure')) / 0.4).toBeLessThan(0.1);
  });

  it('status bits take only their discrete values', () => {
    for (const v of rt.get('drs_status')) if (!Number.isNaN(v)) expect([0, 1]).toContain(v);
    for (const v of rt.get('gps_sat_count'))
      if (!Number.isNaN(v)) expect(Number.isInteger(v)).toBe(true);
  });
});
