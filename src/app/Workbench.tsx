/**
 * The workbench (design-system "Workbench"; Stage 10 style guide): three flat panel columns on
 * the page background: setup (300 px) with Make the call and the docked hint box under it ·
 * result header + strip stack (the rest) · track view, grip circle and channel browser (300 px).
 * Below 1280 px the right column becomes a drawer behind a "Channels" tab; below 960 px the
 * setup stacks under the report.
 *
 * - Strip layout is the global `stripLayout` pref. On entry, an empty layout is filled with the
 *   level's `defaultStrips`; otherwise the persisted layout stays, and channels missing from this
 *   level render as placeholders (UX rule 4).
 * - The stack shows the latest run over the best *other* run (the best before it, or the best
 *   overall when the latest is not the best), so the gap between two lines is always meaningful.
 * - `colorBy` on the track view follows the selected strip.
 * - A failed run shows the fault panel in place of the stack; the session does not count it.
 * - Stage 8 extends it through `headerExtra`, `tableHeader` and `segmentBoundaries`
 *   (`LevelRoute.tsx` composes them), and adds Export CSV to the result header on every level.
 * - Stage 10 playback: a new run is computed instantly, then played back in real time (unless
 *   the `instant` playback pref or `prefers-reduced-motion` is set). While its first playback
 *   runs, its results are gated: the header shows a live time and speed, and the deltas, hints,
 *   Make the call, the channel-table stats and the assist appear when it ends. RUN is disabled
 *   while playing. Replay plays any finished run again (results stay visible).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { trackGeometry } from '@/engine/index';
import type { ChannelId, LeverId, Setup } from '@/engine/types';
import { playbackMode, playbackSpeed, stripLayout, stripSmooth } from '@/game/prefs';
import type { RunRecord } from '@/game/types';
import { renderTier, ruleFor } from '@/hints/engine';
import type { LevelId } from '@/levels/types';
import { ChannelTable } from '@/report/ChannelTable';
import { resetCursor } from '@/report/cursor-store';
import { ResultHeader } from '@/report/ResultHeader';
import { selectedStrip } from '@/report/selection';
import { StripStack } from '@/report/StripStack';
import { toggleStrip } from '@/report/strip-ops';
import { TrackView } from '@/report/TrackView';
import { GripCircle } from '@/report/GripCircle';
import type { ResultHeaderExtra } from '@/report/types';
import type { UnitSystem } from '@/units';
import { HintControls } from '@/setup/HintControls';
import { SetupPanel } from '@/setup/SetupPanel';
import { runSeed } from '@/worker/build-input';
import { WaterfallOverlay } from '@/viz3d/WaterfallOverlay';
import { CsvButton } from '@/report/CsvButton';
import { PlaybackControls } from '@/report/PlaybackControls';
import {
  isGated,
  playState,
  resetPlayback,
  setPlaySpeed,
  startPlayback,
  type Speed,
} from '@/report/playback';
import { workbenchActions } from './actions';
import { BriefModal } from './BriefModal';
import { CallPanel } from './CallPanel';
import { Button } from './components/Button';
import { FaultPanel, type FaultInfo } from './FaultPanel';
import { levelState, openHint } from './game-store';
import { log } from './log';
import { debriefPath, navigate } from './router';
import './screens.css';

export interface WorkbenchProps {
  levelId: LevelId;
  units: UnitSystem;
  /** Extra result-header chips (Stage 8: compromise gap). */
  headerExtra?: ResultHeaderExtra[];
  /**
   * Slot docked at the top of the channel table (Stage 8: assist). A function receives the
   * stack state and the strip actions.
   */
  tableHeader?: ComponentChildren | ((ctx: TableHeaderCtx) => ComponentChildren);
  /** Segment boundaries in axis units (Phase B). */
  segmentBoundaries?: number[];
  axis?: 'time' | 'distance';
}

/** What a function-form `tableHeader` gets from the workbench. */
export interface TableHeaderCtx {
  inStack: ReadonlySet<ChannelId>;
  /** Adds the strip (if missing) without flashing it. */
  addChannel(id: ChannelId): void;
  /** Adds the strip if missing and flashes its gutter. */
  showChannel(id: ChannelId): void;
  /** Stage 10: true while the latest run's results are still hidden by its first playback. */
  gated: boolean;
}

declare global {
  // Dev/test hook: the next run sends an invalid setup so the engine rejects it.
  var __SIGNAL_FORCE_FAULT__: boolean | undefined;
}

const LEVER_IDS: LeverId[] = ['throttle_ramp', 'tire_pressure', 'weight_dist', 'wing'];

/** Whether the OS asks for reduced motion (new runs then show complete; Replay still plays). */
function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Plays a run back from its first sample. `gating`: hide its results until the end. */
export function playRun(rec: RunRecord, gating: boolean): void {
  startPlayback({ runIndex: rec.index, n: rec.telemetry.n, dt: rec.telemetry.dt, gating });
}

/** Should a new run be played back (rather than shown complete)? */
export function playsBack(): boolean {
  return playbackMode.value === 'realtime' && !prefersReducedMotion();
}

/** Sets the playback speed now and persists it. */
export function chooseSpeed(s: Speed): void {
  setPlaySpeed(s);
  playbackSpeed.value = s;
}

function bestOf(runs: RunRecord[]): RunRecord | null {
  let b: RunRecord | null = null;
  for (const r of runs) {
    if (!r.outcome.finished) continue;
    if (!b || r.outcome.totalTime < b.outcome.totalTime) b = r;
  }
  return b;
}

export function Workbench({
  levelId,
  units,
  headerExtra,
  tableHeader,
  segmentBoundaries,
  axis = 'distance',
}: WorkbenchProps) {
  const st = levelState(levelId)!;
  const { session } = st;
  const level = session.level;
  const [running, setRunning] = useState(false);
  const [fault, setFault] = useState<FaultInfo | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [flash, setFlash] = useState<ChannelId | null>(null);
  const [briefOpen, setBriefOpen] = useState(!st.briefSeen.value);
  const [waterfall, setWaterfall] = useState<ChannelId | null>(null);
  const hintOpen = st.hintBoxOpen.value;
  const setHintOpen = (open: boolean) => {
    st.hintBoxOpen.value = open;
  };

  // Fill an empty layout with the level defaults (never replace a persisted one).
  useEffect(() => {
    if (stripLayout.value.length === 0) stripLayout.value = [...level.defaultStrips];
    resetCursor();
    resetPlayback();
    setPlaySpeed(playbackSpeed.value);
    selectedStrip.value = null;
    return () => {
      resetPlayback();
      resetCursor();
    };
  }, [level.id]);

  const runs = session.runs.value;
  const latest = runs[runs.length - 1] ?? null;
  const prev = runs[runs.length - 2] ?? null;
  const grid = session.grid.value;
  const status = session.status.value;
  const strips = stripLayout.value;
  const playingNow = playState.value !== 'idle';
  // The latest run's first playback hides its results until it ends.
  const gated = isGated(latest?.index);
  const shownRuns = gated ? runs.slice(0, -1) : runs;
  const shown = shownRuns[shownRuns.length - 1] ?? null;
  const shownPrev = shownRuns[shownRuns.length - 2] ?? null;
  const rtt = session.runsToTarget.value;
  const passedShown = rtt !== null && rtt <= shownRuns.length;
  const hintsAt = session.hintsAtPass.value ?? 0;

  const priorBest = useMemo(() => bestOf(runs.slice(0, -1)), [runs]);
  const overallBest = session.best.value;
  const overlay = overallBest && overallBest !== latest ? overallBest : priorBest;

  const available = useMemo(() => new Set(level.channelSet), [level]);
  const inStack = useMemo(() => new Set(strips), [strips]);
  const smoothList = stripSmooth.value;
  const smoothed = useMemo(() => new Set(smoothList), [smoothList]);
  const toggleSmooth = (id: ChannelId) => {
    const cur = stripSmooth.value;
    stripSmooth.value = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  };
  const geometry = useMemo(() => trackGeometry(level.track), [level]);
  const segmentLabels = useMemo(() => level.track.segments.map((s) => s.label), [level]);

  const setStrips = (next: ChannelId[]) => {
    stripLayout.value = next;
  };

  const showChannel = (id: ChannelId) => {
    if (!stripLayout.value.includes(id)) stripLayout.value = [...stripLayout.value, id];
    setFlash(null);
    queueMicrotask(() => setFlash(id));
  };

  const doRun = async () => {
    if (running || status === 'computing' || playState.peek() !== 'idle') return;
    const setup: Setup = { ...st.draft.value };
    const sent: Setup = globalThis.__SIGNAL_FORCE_FAULT__
      ? { ...setup, throttle_ramp: Number.NaN }
      : setup;
    const runIndex = session.runs.value.length + 1;
    setRunning(true);
    setFault(null);
    try {
      const rec = await session.run(sent);
      if (playsBack()) playRun(rec, true);
      else resetCursor();
    } catch (err) {
      log.error('run failed', err);
      setFault({
        error: err,
        context: 'run',
        levelId: level.id,
        runIndex,
        seed: runSeed(level.id, runIndex),
        setup: sent,
      });
    } finally {
      setRunning(false);
    }
  };

  // Hint state for the latest revealed run.
  const top = shown?.hints[0] ?? null;
  const rule = top ? ruleFor(level, top) : undefined;
  const tiers = gated ? 0 : session.hintTiersOpened.value;
  const texts =
    rule && top
      ? [0, 1, 2].slice(0, tiers).map((t) => renderTier(rule, top, t as 0 | 1 | 2, units))
      : [];
  const hintWindow = top && tiers > 0 ? (top.window ?? null) : null;
  const prevRules = new Set((shownPrev?.hints ?? []).map((h) => h.ruleId));
  const newRules = (shown?.hints ?? []).filter((h) => !prevRules.has(h.ruleId)).length;

  const toggleHint = () => setHintOpen(!st.hintBoxOpen.value);
  const replay = () => {
    if (latest && playState.peek() === 'idle') playRun(latest, false);
  };

  // Register for the global keyboard map and the palette.
  useEffect(() => {
    workbenchActions.value = {
      run: () => void doRun(),
      toggleHint,
      addChannel: showChannel,
      openBrief: () => setBriefOpen(true),
      replay,
      channels: level.channelSet,
      inStack,
    };
  });
  useEffect(
    () => () => {
      workbenchActions.value = null;
    },
    [],
  );

  const runState: 'computing' | 'running' | 'ready' | 'playing' =
    status === 'computing' ? 'computing' : running ? 'running' : playingNow ? 'playing' : 'ready';

  const changed = latest && prev ? LEVER_IDS.filter((k) => latest.setup[k] !== prev.setup[k]) : [];
  const headerRun = latest
    ? { index: latest.index, time: latest.outcome.totalTime, setup: latest.setup, changed }
    : null;
  const isPB = !!latest && !!priorBest && latest.outcome.totalTime < priorBest.outcome.totalTime;
  const latestPassed = !!latest && !!grid && latest.outcome.totalTime <= grid.target;
  const hintsOpened = session.hintsOpened.value;

  const emptyReason = !shown
    ? 'No run yet. Hints read the run you just made.'
    : 'Nothing in this run trips a rule. Compare it against your best on the strips.';

  const headerCtx: TableHeaderCtx = {
    inStack,
    addChannel: (id) => {
      if (!stripLayout.value.includes(id)) stripLayout.value = [...stripLayout.value, id];
    },
    showChannel,
    gated,
  };
  const tableNode: ComponentChildren =
    typeof tableHeader === 'function'
      ? (tableHeader as (ctx: TableHeaderCtx) => ComponentChildren)(headerCtx)
      : tableHeader;

  return (
    <div
      class={`wb${drawer ? ' wb--drawer' : ''}`}
      data-testid="workbench"
      data-level={level.id}
      data-playing={playingNow || undefined}
    >
      <SetupPanel
        level={level}
        setup={st.draft.value}
        onChange={(next) => {
          st.draft.value = next;
        }}
        lastSetup={latest?.setup ?? null}
        units={units}
        onRun={() => void doRun()}
        runState={runState}
        progress={session.gridProgress.value}
        hints={
          <>
            <CallPanel
              level={level}
              session={session}
              units={units}
              inStack={inStack}
              shownRuns={shownRuns.length}
              onAdd={(id) => {
                if (!stripLayout.value.includes(id)) stripLayout.value = [...stripLayout.value, id];
              }}
              onChannelClick={showChannel}
            />
            <HintControls
              available={!!top}
              tiersOpened={top ? tiers : 0}
              texts={texts}
              open={hintOpen}
              onOpenChange={setHintOpen}
              onOpenNext={() => {
                openHint(st);
              }}
              onChannelClick={showChannel}
              emptyReason={emptyReason}
              newCount={newRules}
              hintsOpened={hintsOpened}
              pending={gated}
            />
          </>
        }
      />

      <div class="wb__center panel">
        <ResultHeader
          run={headerRun}
          bestTime={priorBest ? priorBest.outcome.totalTime : null}
          target={grid?.target ?? null}
          isPB={isPB}
          passed={latestPassed}
          lockedLevers={level.lockedLevers}
          levers={level.levers}
          units={units}
          runs={runs.length}
          hints={hintsOpened}
          live={gated && latest ? { index: latest.index, telemetry: latest.telemetry } : null}
          controls={
            <PlaybackControls canReplay={!!latest} onReplay={replay} onSpeed={chooseSpeed} />
          }
          {...(headerExtra && !gated ? { extra: headerExtra } : {})}
          {...(latest
            ? {
                actions: (
                  <CsvButton
                    levelId={level.id}
                    run={{
                      index: latest.index,
                      seed: latest.seed,
                      setup: latest.setup,
                      telemetry: latest.telemetry,
                    }}
                    units={units}
                  />
                ),
              }
            : {})}
        />
        {passedShown && (
          <div class="wb__notice" data-testid="passed-notice">
            <span class="chip chip--best">Target met</span>
            <span class="wb__notice-text">
              {`On run ${rtt} · ${hintsAt} hint${hintsAt === 1 ? '' : 's'}. Keep running, or read the debrief.`}
            </span>
            <Button
              variant="secondary"
              size="compact"
              class="wb__notice-cta"
              onClick={() => navigate(debriefPath(level.id))}
            >
              Continue to debrief
            </Button>
          </div>
        )}
        <div class="wb__stack" tabIndex={-1}>
          {fault ? (
            <div class="wb__fault">
              <FaultPanel fault={fault} onDismiss={() => setFault(null)} />
            </div>
          ) : (
            <StripStack
              current={latest?.telemetry ?? null}
              best={overlay?.telemetry ?? null}
              strips={strips}
              onStripsChange={setStrips}
              availableIds={available}
              axis={axis}
              {...(segmentBoundaries ? { segmentBoundaries, segmentLabels } : {})}
              hintWindow={hintWindow}
              units={units}
              flashChannel={flash}
              gutterMenu={(id) => [
                { label: 'Waterfall…', onSelect: () => setWaterfall(id) },
                {
                  label: 'Smooth (5-pt centred mean)',
                  checked: smoothed.has(id),
                  onSelect: () => toggleSmooth(id),
                },
              ]}
              smoothed={smoothed}
            />
          )}
          {!latest && !fault && (
            <p class="wb__empty">
              {status === 'computing'
                ? `Computing the target: ${Math.round(session.gridProgress.value * 100)}%`
                : 'Strips fill in after the first run. The channel browser lists every channel on this car.'}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        class="wb__drawer-tab"
        aria-expanded={drawer}
        aria-controls="wb-right"
        onClick={() => setDrawer(!drawer)}
        data-testid="drawer-tab"
      >
        {drawer ? 'Close ▸' : '◂ Track & channels'}
      </button>
      <aside id="wb-right" class="wb__right" aria-label="Track and channels">
        <div class="wb__track panel">
          <TrackView
            geometry={geometry}
            current={latest?.telemetry ?? null}
            best={overlay?.telemetry ?? null}
            colorBy={selectedStrip.value}
            segmentLabels={segmentLabels}
            units={units}
            axis={axis}
          />
          <GripCircle
            current={latest?.telemetry ?? null}
            best={overlay?.telemetry ?? null}
            axis={axis}
            units={units}
          />
        </div>
        <div class="wb__table panel">
          <ChannelTable
            ids={level.channelSet}
            current={gated ? null : (latest?.summary ?? null)}
            best={overlay?.summary ?? null}
            inStack={inStack}
            onToggle={(id) => setStrips(toggleStrip(stripLayout.value, id))}
            units={units}
            header={tableNode}
          />
        </div>
      </aside>

      {waterfall && (
        <WaterfallOverlay
          runs={runs}
          channel={waterfall}
          units={units}
          axis={axis}
          slot={Math.max(0, strips.indexOf(waterfall))}
          levers={level.levers}
          onClose={() => setWaterfall(null)}
        />
      )}
      {briefOpen && (
        <BriefModal
          level={level}
          target={grid?.target ?? null}
          progress={session.gridProgress.value}
          units={units}
          started={st.briefSeen.value}
          onBegin={() => {
            st.briefSeen.value = true;
            setBriefOpen(false);
          }}
        />
      )}
    </div>
  );
}
