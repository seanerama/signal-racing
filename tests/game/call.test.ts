/**
 * Stage 9 "Make the call": level content rules and the session record.
 * - Every `call` has three options, exactly one correct (flag and cross-check), cross-check
 *   channels on the level, and a planted artifact on its run.
 * - Answering is possible only once the named run exists, costs no runs, and is recorded once.
 */
import { describe, expect, it } from 'vitest';
import { startLevel } from '@/game/session';
import { B4L, LEVELS } from '@/levels/index';
import { handlers } from '@/worker/handlers';
import type { SimClient } from '@/worker/types';

const ctx = () => ({ progress: () => undefined, transfer: [] as Transferable[] });
const client: SimClient = {
  run: (req) => Promise.resolve(handlers.run(req, ctx())),
  gridSearch: (req) => Promise.resolve(handlers.gridSearch(req, ctx())),
  dispose: () => undefined,
};

describe('call and artifact content', () => {
  for (const level of LEVELS) {
    it(`${level.id}: artifacts and call are well-formed`, () => {
      for (const a of level.artifacts ?? []) {
        expect(level.channelSet).toContain(a.channel);
        expect(a.run).toBeGreaterThanOrEqual(1);
        expect(a.run).toBeLessThanOrEqual(level.runBudget);
      }
      const call = level.call;
      if (!call) return;
      expect(call.options).toHaveLength(3);
      expect(call.options.filter((o) => o.correct)).toHaveLength(1);
      expect(call.options.find((o) => o.correct)!.text.toLowerCase()).toMatch(/flag.*cross-check/);
      for (const id of call.crossCheck) expect(level.channelSet).toContain(id);
      expect((level.artifacts ?? []).some((a) => a.run === call.afterRun)).toBe(true);
      for (const t of [call.question, ...call.options.flatMap((o) => [o.text, o.why])]) {
        expect(t).not.toContain('!');
      }
    });
  }
  it('A2 plants nothing (a wheel-speed offset there would teach against the level)', () => {
    expect(LEVELS.find((l) => l.id === 'A2')!.artifacts).toBeUndefined();
  });
});

describe('session.answerCall', () => {
  it('only after the named run; free; recorded once', async () => {
    const s = startLevel(B4L, client);
    expect(s.call.value).toBeNull();
    await s.run({ throttle_ramp: 0.4, tire_pressure: 1.7, weight_dist: 0.46, wing: 7 });
    expect(s.answerCall('flag')).toBeNull();
    await s.run({ throttle_ramp: 0.4, tire_pressure: 1.7, weight_dist: 0.46, wing: 4 });
    const used = s.runsUsed.value;
    const hints = s.hintsOpened.value;
    expect(s.answerCall('nope')).toBeNull();
    const rec = { afterRun: 2, optionId: 'flag', correct: true, atRun: 2 };
    expect(s.answerCall('flag')).toEqual(rec);
    expect(s.runsUsed.value).toBe(used);
    expect(s.hintsOpened.value).toBe(hints);
    // A second answer does not overwrite the first.
    expect(s.answerCall('act')).toEqual(rec);
    expect(s.call.value?.optionId).toBe('flag');
  }, 60_000);
});
