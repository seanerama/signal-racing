/**
 * Stage 9 planted sensor artifacts ("Make the call"): deterministic, present in `get()` only, and
 * invisible to `getClean()`, the clean summary, hint matches, the assist and the outcome.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSIST_TOP, RULE_WEIGHT } from '@/assist/config';
import { assistChannels, describer } from '@/assist/puzzle';
import { rankChannels } from '@/assist/rank';
import { startLevel } from '@/game/session';
import type { RunRecord } from '@/game/types';
import { B4L } from '@/levels/index';
import { SPIKE_AT_M } from '@/levels/b4l-puzzle';
import type { LevelConfig } from '@/levels/types';
import { allChannels } from '@/telemetry/registry';
import { applyArtifacts, artifactIndex, createRunTelemetry } from '@/telemetry/run-telemetry';
import { summarize } from '@/telemetry/summary';
import type { SensorArtifact } from '@/telemetry/types';
import { handlers } from '@/worker/handlers';
import type { SimClient } from '@/worker/types';
import { CORNER_TRACK, makeFixture } from './fixtures';

const pc = makeFixture({ segments: CORNER_TRACK });
const IDS = allChannels().map((c) => c.id);
const same = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

describe('artifact helpers', () => {
  const run = { n: 5, dt: 0.01, t: [0, 0.01, 0.02, 0.03, 0.04], s: [0, 1, 2, 3, 4] };
  it('artifactIndex: first t ≥ at.t, else first s ≥ at.s, else 0', () => {
    expect(artifactIndex(run, { t: 0.02 })).toBe(2);
    expect(artifactIndex(run, { s: 2.5 })).toBe(3);
    expect(artifactIndex(run, { t: 0.015, s: 4 })).toBe(2);
    expect(artifactIndex(run, {})).toBe(0);
    expect(artifactIndex(run, { s: 99 })).toBe(4);
  });
  it('spike, step and stuck; a dropout under the artifact still shows it', () => {
    const clean = new Float32Array([1, 2, 3, 4, 5]);
    const a: SensorArtifact = { run: 1, channel: 'x', kind: 'spike', at: { s: 1 }, magnitude: 10 };
    const out = new Float32Array([1, NaN, 3, 4, 5]);
    applyArtifacts(out, clean, run, [a]);
    expect([...out]).toEqual([1, 12, 3, 4, 5]);
    const step = new Float32Array(clean);
    applyArtifacts(step, clean, run, [{ ...a, kind: 'step' }]);
    expect([...step]).toEqual([1, 12, 13, 14, 15]);
    const stuck = new Float32Array(clean);
    applyArtifacts(stuck, clean, run, [{ ...a, kind: 'stuck', magnitude: 0, durationS: 0.03 }]);
    expect([...stuck]).toEqual([1, 2, 2, 2, 5]);
  });
});

describe('createRunTelemetry with artifacts', () => {
  const spike: SensorArtifact = {
    run: 1,
    channel: 'speed_diff_rl',
    kind: 'spike',
    at: { s: 300 },
    magnitude: 7.7,
  };
  const plain = createRunTelemetry({ physical: pc, channelIds: IDS, seed: 9 });
  const planted = createRunTelemetry({
    physical: pc,
    channelIds: IDS,
    seed: 9,
    artifacts: [spike],
  });
  const again = createRunTelemetry({ physical: pc, channelIds: IDS, seed: 9, artifacts: [spike] });

  it('is deterministic', () => {
    expect(same(planted.get('speed_diff_rl'), again.get('speed_diff_rl'))).toBe(true);
  });

  it('moves one channel for one sample in get(); getClean() is untouched', () => {
    const i0 = artifactIndex(pc, spike.at);
    const a = plain.get('speed_diff_rl');
    const b = planted.get('speed_diff_rl');
    const diff = [...b].flatMap((v, i) => (Object.is(v, a[i]) ? [] : [i]));
    expect(diff).toEqual([i0]);
    expect(
      b[i0]! - (Number.isNaN(a[i0]!) ? planted.getClean('speed_diff_rl')[i0]! : a[i0]!),
    ).toBeCloseTo(7.7, 4);
    for (const id of IDS) {
      expect(same(plain.getClean(id), planted.getClean(id)), id).toBe(true);
      if (id !== 'speed_diff_rl') expect(same(plain.get(id), planted.get(id)), id).toBe(true);
    }
  });

  it('the clean summary ignores it; the displayed stats show it', () => {
    const sa = summarize(plain);
    const sb = summarize(planted);
    expect(sb.clean).toEqual(sa.clean);
    expect(sb.stats.speed_diff_rl!.mean).toBeGreaterThan(sa.stats.speed_diff_rl!.mean);
  });

  it('an artifact on a physical sensor carries into the math channels computed from it', () => {
    const step: SensorArtifact = {
      ...spike,
      channel: 'wheel_speed_rl',
      kind: 'step',
      magnitude: 2,
    };
    const rt = createRunTelemetry({ physical: pc, channelIds: IDS, seed: 9, artifacts: [step] });
    const i0 = artifactIndex(pc, step.at);
    const a = plain.get('speed_diff_rl');
    const b = rt.get('speed_diff_rl');
    for (const i of [i0, i0 + 10, pc.n - 1]) {
      if (Number.isFinite(a[i]!) && Number.isFinite(b[i]!)) expect(b[i]! - a[i]!).toBeCloseTo(2, 3);
    }
    expect(Object.is(a[0], b[0])).toBe(true);
  });
});

describe('B4L: the planted spike changes no hint, assist rank or outcome', () => {
  const ctx = () => ({ progress: () => undefined, transfer: [] as Transferable[] });
  const client: SimClient = {
    run: (req) => Promise.resolve(handlers.run(req, ctx())),
    gridSearch: (req) => Promise.resolve(handlers.gridSearch(req, ctx())),
    dispose: () => undefined,
  };
  const SETUPS = [
    { throttle_ramp: 0.4, tire_pressure: 1.7, weight_dist: 0.46, wing: 7 },
    { throttle_ramp: 0.4, tire_pressure: 1.7, weight_dist: 0.46, wing: 4 },
    { throttle_ramp: 0.2, tire_pressure: 1.7, weight_dist: 0.46, wing: 4 },
  ];
  const play = async (level: LevelConfig): Promise<RunRecord[]> => {
    const s = startLevel(level, client);
    for (const setup of SETUPS) await s.run(setup);
    return s.runs.value;
  };
  let withArt: RunRecord[] = [];
  let without: RunRecord[] = [];
  beforeAll(async () => {
    withArt = await play(B4L);
    without = await play({ ...B4L, artifacts: [] });
  }, 120_000);

  it('B4L plants exactly one spike, on run 2, at the configured distance', () => {
    expect(B4L.artifacts).toEqual([
      expect.objectContaining({
        run: 2,
        channel: 'speed_diff_rl',
        kind: 'spike',
        at: { s: SPIKE_AT_M },
      }),
    ]);
    const a = withArt[1]!.telemetry.get('speed_diff_rl');
    const b = without[1]!.telemetry.get('speed_diff_rl');
    const diff = [...a].flatMap((v, i) => (Object.is(v, b[i]) ? [] : [i]));
    expect(diff).toHaveLength(1);
    expect(withArt[1]!.telemetry.s[diff[0]!]!).toBeGreaterThanOrEqual(SPIKE_AT_M);
  });

  it('outcomes, clean summaries and hint matches are identical', () => {
    for (let i = 0; i < SETUPS.length; i++) {
      expect(withArt[i]!.outcome).toEqual(without[i]!.outcome);
      expect(withArt[i]!.summary.clean).toEqual(without[i]!.summary.clean);
      expect(withArt[i]!.hints).toEqual(without[i]!.hints);
    }
  });

  it('assist ranks are identical', () => {
    const rank = (runs: RunRecord[]) =>
      rankChannels({
        runs,
        channelIds: assistChannels(B4L),
        ruleWeight: RULE_WEIGHT,
        top: ASSIST_TOP,
        describe: describer(B4L, 'metric'),
      });
    expect(rank(withArt)).toEqual(rank(without));
  });
});
