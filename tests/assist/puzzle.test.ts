/**
 * The assist on the real Puzzle (B4L): the recorded unassisted attempt from the demo profile
 * (`src/app/demo-history.json`), re-simulated exactly as the app does it (worker handlers →
 * session → telemetry → summary → hints). Checks the guarantees that matter in the meeting:
 * - no reason, at any run count, names a lever (id or label) or a setup value;
 * - the assist only ever returns channels of the level, never outcome channels;
 * - the recorded attempt reaches the target on run 4 (unassisted; re-recorded by hand in Stage 11);
 * - raw correlation alone puts an echo channel in the top five at some point, and the rule
 *   priors keep it out (the debrief's spurious-correlation note).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSIST_TOP, RULE_WEIGHT } from '@/assist/config';
import { assistChannels, describer, isEchoChannel } from '@/assist/puzzle';
import { demotedEcho, rankChannels, type AssistRun } from '@/assist/rank';
import history from '@/app/demo-history.json';
import { runPasses, startLevel } from '@/game/session';
import type { RunRecord } from '@/game/types';
import { B4L } from '@/levels/index';
import { handlers } from '@/worker/handlers';
import type { SimClient } from '@/worker/types';

const ctx = () => ({ progress: () => undefined, transfer: [] as Transferable[] });
const client: SimClient = {
  run: (req) => Promise.resolve(handlers.run(req, ctx())),
  gridSearch: (req) => Promise.resolve(handlers.gridSearch(req, ctx())),
  dispose: () => undefined,
};

let runs: RunRecord[] = [];
let passIndex: number | null = null;

beforeAll(async () => {
  const s = startLevel(B4L, client);
  for (const r of history.runs) await s.run(r.setup);
  runs = s.runs.value;
  const g = s.grid.value!;
  passIndex = runs.find((r) => runPasses(B4L, r, g))?.index ?? null;
}, 120_000);

const LEVER_WORDS = [
  'throttle_ramp',
  'tire_pressure',
  'weight_dist',
  'wing',
  'throttle ramp',
  'tire pressure',
  'weight distribution',
];
/** A setup value with its unit, as the setup chips would print it. */
const SETUP_VALUE = /\b\d+(\.\d+)?\s*(bar|psi)\b/;

describe('assist on the recorded Puzzle attempt', () => {
  it('the recorded unassisted attempt meets the target on run 4', () => {
    expect(runs).toHaveLength(4);
    expect(passIndex).toBe(4);
  });

  it('never names a lever or a setup value, at any run count, in either unit system', () => {
    const ids = assistChannels(B4L);
    for (const units of ['metric', 'imperial'] as const) {
      for (let n = 3; n <= runs.length; n++) {
        const rows = rankChannels({
          runs: runs.slice(0, n),
          channelIds: ids,
          ruleWeight: RULE_WEIGHT,
          top: ASSIST_TOP,
          describe: describer(B4L, units),
        });
        expect(rows).toHaveLength(5);
        for (const r of rows) {
          expect(B4L.channelSet).toContain(r.channel);
          expect(B4L.channelRoles[r.channel]).not.toBe('outcome');
          const text = `${r.channel} ${r.reason}`.toLowerCase();
          for (const w of LEVER_WORDS) expect(text, `${n} runs: ${r.reason}`).not.toContain(w);
          expect(r.reason).not.toMatch(SETUP_VALUE);
        }
      }
    }
  });

  it('raw correlation ranks an echo channel in the top five; the priors demote it', () => {
    const pool: AssistRun[] = runs;
    const d = demotedEcho({
      runs: pool,
      channelIds: assistChannels(B4L),
      isEcho: isEchoChannel,
      ruleWeight: RULE_WEIGHT,
      top: ASSIST_TOP,
    });
    console.log(
      `recorded attempt: priors demoted ${d?.channel} at run ${d?.n} (raw rank ${d?.rawRank})`,
    );
    expect(d).not.toBeNull();
    expect(isEchoChannel(d!.channel)).toBe(true);
  });

  it('stored seeds are the run seeds the game uses', async () => {
    const { runSeed } = await import('@/worker/build-input');
    for (const r of history.runs) expect(r.seed).toBe(runSeed('B4L', r.runIndex));
  });
});
