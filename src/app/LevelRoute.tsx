/**
 * The level route: the Workbench plus the Stage 8 extensions a level asks for.
 *
 * - Phase B: the Axis control is live (first entry forces the distance axis, contract 06), and
 *   the segment boundaries are drawn through every strip: segment start distances on the
 *   distance axis, or the latest run's segment start times on the time axis.
 * - `scoreTarget: 'compromise_gap'` (B1L): header chips `Compromise gap +0.412 s` (best-toned when
 *   it passes, loss-toned when not) and the best achievable gap against the engine floors.
 * - `assist` (B4L): the assist block in the channel table's header slot.
 */
import { useEffect, useMemo } from 'preact/hooks';
import { ASSIST_MIN_RUNS, ASSIST_TOP, RULE_WEIGHT } from '@/assist/config';
import { assistChannels, describer } from '@/assist/puzzle';
import { rankChannels } from '@/assist/rank';
import type { ChannelId } from '@/engine/types';
import { axisMode, enterPhaseB } from '@/game/prefs';
import { bestAchievableGap, compromiseGap, gapPassLimit } from '@/game/session';
import type { LevelSession, RunRecord } from '@/game/types';
import { getLevel } from '@/levels/index';
import type { LevelConfig, LevelId } from '@/levels/types';
import { AssistBlock } from '@/report/AssistBlock';
import type { ResultHeaderExtra } from '@/report/types';
import { segmentStartTimes } from '@/telemetry/derived';
import { formatValue, type UnitSystem } from '@/units';
import type { GridResult } from '@/worker/types';
import { assistHistory, levelState } from './game-store';
import { Workbench, type TableHeaderCtx } from './Workbench';

/** Segment boundaries in axis units (the start of every segment after the first). */
export function segmentBoundaries(
  level: LevelConfig,
  axis: 'time' | 'distance',
  latest: RunRecord | null,
): number[] {
  const segs = level.track.segments;
  if (segs.length < 2) return [];
  if (axis === 'distance') {
    const out: number[] = [];
    let s = 0;
    for (let i = 0; i < segs.length - 1; i++) out.push((s += segs[i]!.length));
    return out;
  }
  if (!latest) return [];
  const tel = latest.telemetry;
  return segmentStartTimes({
    n: tel.n,
    dt: tel.dt,
    t: tel.t,
    s: tel.s,
    seg: tel.seg,
    ch: {},
  }).slice(1);
}

/** `+0.412 s` with an explicit sign. */
function signedTime(v: number, units: UnitSystem): string {
  const txt = formatValue('time', units, Math.abs(v));
  return `${v < 0 ? '−' : '+'}${txt}`;
}

/** The compromise-gap chips for the latest run (B1L). */
export function gapChips(
  latest: RunRecord | null,
  grid: GridResult | null,
  units: UnitSystem,
): ResultHeaderExtra[] {
  if (!latest || !grid || !latest.outcome.finished) return [];
  const gap = compromiseGap(latest.outcome.totalTime, grid);
  return [
    {
      label: 'Compromise gap',
      value: signedTime(gap, units),
      tone: gap <= gapPassLimit(grid) ? 'best' : 'loss',
    },
    { label: 'best achievable', value: signedTime(bestAchievableGap(grid), units) },
  ];
}

function AssistPanel({
  session,
  level,
  units,
  ctx,
}: {
  session: LevelSession;
  level: LevelConfig;
  units: UnitSystem;
  ctx: TableHeaderCtx;
}) {
  const runs = session.runs.value;
  const on = session.assistOn.value;
  const hist = assistHistory(level.id);
  const ids = useMemo(() => assistChannels(level), [level]);
  const rows = useMemo(
    () =>
      on
        ? rankChannels({
            runs: [...hist.runs, ...runs],
            channelIds: ids,
            ruleWeight: RULE_WEIGHT,
            top: ASSIST_TOP,
            describe: describer(level, units),
          })
        : [],
    [on, runs, hist.runs, ids, level, units],
  );
  const finished = (xs: Array<{ outcome: { finished: boolean } }>) =>
    xs.filter((r) => r.outcome.finished).length;
  return (
    <AssistBlock
      on={on}
      onToggle={(next) => (session.assistOn.value = next)}
      rows={rows}
      counts={{
        session: finished(runs),
        recorded: hist.recorded,
        past: hist.past,
      }}
      minRuns={ASSIST_MIN_RUNS}
      inStack={ctx.inStack}
      onAdd={(id: ChannelId) => ctx.addChannel(id)}
      onChannelClick={(id: ChannelId) => ctx.showChannel(id)}
    />
  );
}

export function LevelRoute({ id, units }: { id: LevelId; units: UnitSystem }) {
  const level = getLevel(id)!;
  const st = levelState(id)!;
  const session = st.session;
  const phaseB = level.phase === 'B';
  useEffect(() => {
    if (phaseB) enterPhaseB();
  }, [id]);

  const axis = phaseB ? axisMode.value : 'time';
  const runs = session.runs.value;
  const latest = runs[runs.length - 1] ?? null;
  const grid = session.grid.value;

  const boundaries = useMemo(
    () => (phaseB ? segmentBoundaries(level, axis, latest) : undefined),
    [phaseB, level, axis, latest],
  );
  const extra = level.scoreTarget === 'compromise_gap' ? gapChips(latest, grid, units) : [];

  return (
    <Workbench
      levelId={id}
      units={units}
      axis={axis}
      {...(boundaries ? { segmentBoundaries: boundaries } : {})}
      {...(extra.length ? { headerExtra: extra } : {})}
      {...(level.assist
        ? {
            tableHeader: (ctx: TableHeaderCtx) => (
              <AssistPanel session={session} level={level} units={units} ctx={ctx} />
            ),
          }
        : {})}
    />
  );
}
