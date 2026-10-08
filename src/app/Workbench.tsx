/**
 * The workbench (design-system "Workbench"): setup panel · result header + strip stack · track
 * view above the channel table, composed around the level's `LevelSession`.
 *
 * - Strip layout is the global `stripLayout` pref. On entry, an empty layout is filled with the
 *   level's `defaultStrips`; otherwise the persisted layout stays, and channels missing from this
 *   level render as placeholders (UX rule 4).
 * - The stack shows the latest run over the best *other* run (the best before it, or the best
 *   overall when the latest is not the best), so the gap between two lines is always meaningful.
 * - `colorBy` on the track view follows the selected strip.
 * - A failed run shows the fault panel in place of the stack; the session does not consume it.
 * - Stage 8 extends it through `headerExtra`, `tableHeader` and `segmentBoundaries`
 *   (`LevelRoute.tsx` composes them), and adds Export CSV to the result header on every level.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { trackGeometry } from '@/engine/index';
import type { ChannelId, LeverId, Setup } from '@/engine/types';
import { stripLayout, stripSmooth } from '@/game/prefs';
import { BudgetError } from '@/game/session';
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
}

declare global {
  // Dev/test hook: the next run sends an invalid setup so the engine rejects it.
  var __SIGNAL_FORCE_FAULT__: boolean | undefined;
}

const LEVER_IDS: LeverId[] = ['throttle_ramp', 'tire_pressure', 'weight_dist', 'wing'];

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
  axis = 'time',
}: WorkbenchProps) {
  const st = levelState(levelId)!;
  const { session } = st;
  const level = session.level;
  const [running, setRunning] = useState(false);
  const [fault, setFault] = useState<FaultInfo | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [flash, setFlash] = useState<ChannelId | null>(null);
  const [briefOpen, setBriefOpen] = useState(!st.briefSeen.value);
  const [waterfall, setWaterfall] = useState<ChannelId | null>(null);

  // Fill an empty layout with the level defaults (never replace a persisted one).
  useEffect(() => {
    if (stripLayout.value.length === 0) stripLayout.value = [...level.defaultStrips];
    resetCursor();
    selectedStrip.value = null;
    return () => resetCursor();
  }, [level.id]);

  const runs = session.runs.value;
  const latest = runs[runs.length - 1] ?? null;
  const prev = runs[runs.length - 2] ?? null;
  const grid = session.grid.value;
  const status = session.status.value;
  const runsLeft = session.runsLeft.value;
  const strips = stripLayout.value;

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
    if (running || status === 'computing' || runsLeft <= 0) return;
    const setup: Setup = { ...st.draft.value };
    const sent: Setup = globalThis.__SIGNAL_FORCE_FAULT__
      ? { ...setup, throttle_ramp: Number.NaN }
      : setup;
    const runIndex = session.runs.value.length + 1;
    setRunning(true);
    setFault(null);
    setHintOpen(false);
    try {
      await session.run(sent);
    } catch (err) {
      if (err instanceof BudgetError) return;
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

  // Hint state for the latest run.
  const top = latest?.hints[0] ?? null;
  const rule = top ? ruleFor(level, top) : undefined;
  const tiers = session.hintTiersOpened.value;
  const texts =
    rule && top
      ? [0, 1, 2].slice(0, tiers).map((t) => renderTier(rule, top, t as 0 | 1 | 2, units))
      : [];
  const hintWindow = top && tiers > 0 ? (top.window ?? null) : null;

  const toggleHint = () => setHintOpen((o) => !o);

  // Register for the global keyboard map and the palette.
  useEffect(() => {
    workbenchActions.value = {
      run: () => void doRun(),
      toggleHint,
      addChannel: showChannel,
      openBrief: () => setBriefOpen(true),
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

  const runState: 'computing' | 'running' | 'ready' | 'spent' =
    status === 'computing' ? 'computing' : running ? 'running' : runsLeft <= 0 ? 'spent' : 'ready';

  const changed = latest && prev ? LEVER_IDS.filter((k) => latest.setup[k] !== prev.setup[k]) : [];
  const headerRun = latest
    ? { index: latest.index, time: latest.outcome.totalTime, setup: latest.setup, changed }
    : null;
  const isPB = !!latest && !!priorBest && latest.outcome.totalTime < priorBest.outcome.totalTime;
  const latestPassed = !!latest && !!grid && latest.outcome.totalTime <= grid.target;

  const emptyReason = !latest
    ? 'No run yet. Hints read the run you just made.'
    : 'Nothing in this run trips a rule. Compare it against your best on the strips.';

  const headerCtx: TableHeaderCtx = {
    inStack,
    addChannel: (id) => {
      if (!stripLayout.value.includes(id)) stripLayout.value = [...stripLayout.value, id];
    },
    showChannel,
  };
  const tableNode: ComponentChildren =
    typeof tableHeader === 'function'
      ? (tableHeader as (ctx: TableHeaderCtx) => ComponentChildren)(headerCtx)
      : tableHeader;

  return (
    <div class="wb" data-testid="workbench" data-level={level.id}>
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
              onAdd={(id) => {
                if (!stripLayout.value.includes(id)) stripLayout.value = [...stripLayout.value, id];
              }}
              onChannelClick={showChannel}
            />
            <HintControls
              available={!!top}
              tiersOpened={top ? tiers : 0}
              cost={level.hintCost}
              runsLeft={runsLeft}
              texts={texts}
              open={hintOpen}
              onOpenChange={setHintOpen}
              onOpenNext={() => {
                openHint(st);
              }}
              onChannelClick={showChannel}
              emptyReason={emptyReason}
            />
          </>
        }
      />

      <div class="wb__center">
        <ResultHeader
          run={headerRun}
          bestTime={priorBest ? priorBest.outcome.totalTime : null}
          target={grid?.target ?? null}
          isPB={isPB}
          passed={latestPassed}
          lockedLevers={level.lockedLevers}
          levers={level.levers}
          units={units}
          {...(headerExtra ? { extra: headerExtra } : {})}
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
          {...(status === 'passed' ? { onDebrief: () => navigate(debriefPath(level.id)) } : {})}
        />
        {status === 'passed' && !latestPassed && (
          <div class="wb__notice micro dim" data-testid="passed-notice">
            Target met earlier in this session.
          </div>
        )}
        {status === 'exhausted' && (
          <div class="wb__notice" data-testid="exhausted-notice">
            <span class="micro dim">Run budget spent. Target not met.</span>
            <Button
              variant="secondary"
              size="compact"
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
            <p class="wb__empty micro faint">
              {status === 'computing'
                ? `Computing the target: ${Math.round(session.gridProgress.value * 100)}%`
                : 'Strips fill in after the first run. The table on the right lists every channel on this car.'}
            </p>
          )}
        </div>
      </div>

      <aside class="wb__right" aria-label="Track and channels">
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
        <div class="wb__table">
          <ChannelTable
            ids={level.channelSet}
            current={latest?.summary ?? null}
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
