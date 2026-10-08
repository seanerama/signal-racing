/**
 * `/#/dev/viz3d`: both 3D data views on real data. Runs the A2 level through the sim worker
 * (grid search + a few player setups via `startLevel`), then shows:
 * - a strip stack whose gutter menu carries "Waterfall…" (opens the overlay for that channel);
 * - the response surface panel, as the Debrief will mount it (with a 1-lever variant, A1-style).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button } from '@/app/components/Button';
import { SegmentedControl } from '@/app/components/SegmentedControl';
import { log } from '@/app/log';
import type { ChannelId, Setup } from '@/engine/types';
import { startLevel, type LevelSession, type RunRecord } from '@/game/session';
import { getLevel } from '@/levels/index';
import type { LevelConfig } from '@/levels/types';
import { StripStack } from '@/report/StripStack';
import { toggleStrip } from '@/report/strip-ops';
import type { UnitSystem } from '@/units';
import { createSimClient } from '@/worker/client';
import type { GridResult } from '@/worker/types';
import type { AxisMode } from './types';
import { ResponseSurfacePanel } from './ResponseSurfacePanel';
import { WaterfallOverlay } from './WaterfallOverlay';

const LOCKED = { weight_dist: 0.45, wing: 4 };
/** A plausible player session on A2: one change at a time, converging on the launch. */
const SETUPS: Setup[] = [
  { throttle_ramp: 0, tire_pressure: 1.9, ...LOCKED },
  { throttle_ramp: 0.3, tire_pressure: 1.9, ...LOCKED },
  { throttle_ramp: 0.6, tire_pressure: 1.9, ...LOCKED },
  { throttle_ramp: 0.6, tire_pressure: 1.7, ...LOCKED },
  { throttle_ramp: 0.8, tire_pressure: 1.7, ...LOCKED },
];

type Phase =
  | { kind: 'loading'; note: string }
  | { kind: 'ready'; level: LevelConfig; grid: GridResult; runs: RunRecord[] }
  | { kind: 'error'; message: string };

async function playSession(onNote: (s: string) => void): Promise<Phase> {
  const level = getLevel('A2');
  if (!level) throw new Error('level A2 missing');
  const client = createSimClient();
  try {
    const session: LevelSession = startLevel(level, client);
    onNote('grid search…');
    for (const [i, s] of SETUPS.entries()) {
      onNote(`run ${i + 1} of ${SETUPS.length}…`);
      await session.run(s);
    }
    const grid = session.grid.value;
    if (!grid) throw new Error('grid search did not finish');
    return { kind: 'ready', level, grid, runs: session.runs.value };
  } finally {
    client.dispose();
  }
}

/** A1-style variant: the second lever locked at its optimum, samples sliced to match. */
function oneLever(level: LevelConfig, grid: GridResult): { level: LevelConfig; grid: GridResult } {
  const [keep, drop] = level.levers;
  if (!keep || !drop) return { level, grid };
  const v = grid.optimum.setup[drop.id];
  return {
    level: { ...level, levers: [keep], lockedLevers: { ...level.lockedLevers, [drop.id]: v } },
    grid: {
      ...grid,
      samples: grid.samples.filter((s) => Math.abs(s.setup[drop.id] - v) < drop.step / 2),
    },
  };
}

export function DevViz3d({ units }: { units: UnitSystem }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', note: 'starting worker…' });
  const [strips, setStrips] = useState<ChannelId[]>([]);
  const [axis, setAxis] = useState<AxisMode>('time');
  const [levers, setLevers] = useState<'2' | '1'>('2');
  const [surface, setSurface] = useState<'on' | 'off'>('on');
  const [waterfall, setWaterfall] = useState<ChannelId | null>(null);

  useEffect(() => {
    let live = true;
    playSession((note) => live && setPhase({ kind: 'loading', note })).then(
      (p) => {
        if (!live) return;
        if (p.kind === 'ready') setStrips([...p.level.defaultStrips, 'rear_slip_ratio']);
        setPhase(p);
      },
      (err: unknown) => {
        log.error('dev viz3d session failed', err);
        if (live)
          setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const ready = phase.kind === 'ready' ? phase : null;
  const current = ready?.runs[ready.runs.length - 1] ?? null;
  const best = useMemo(() => {
    if (!ready) return null;
    return ready.runs.reduce<RunRecord | null>(
      (b, r) => (!b || r.outcome.totalTime < b.outcome.totalTime ? r : b),
      null,
    );
  }, [ready]);
  const surfaceInput = useMemo(() => {
    if (!ready) return null;
    return levers === '1'
      ? oneLever(ready.level, ready.grid)
      : { level: ready.level, grid: ready.grid };
  }, [ready, levers]);
  const available = useMemo(() => new Set(ready?.level.channelSet ?? []), [ready]);
  const gutterMenu = useMemo(
    () => (id: ChannelId) => [{ label: 'Waterfall…', onSelect: () => setWaterfall(id) }],
    [],
  );

  return (
    <section class="dev-page dev-viz3d" style={{ maxWidth: 'none' }}>
      <h1 class="h2 dim">Dev · 3D data views</h1>
      <div class="dev-row">
        <span class="data" data-testid="viz3d-status" role="status">
          {phase.kind === 'loading' && phase.note}
          {phase.kind === 'error' && <span class="dev-fault">{phase.message}</span>}
          {ready &&
            `A2 · ${ready.runs.length} runs · grid ${ready.grid.evaluated} setups · optimum ${ready.grid.optimum.outcome.totalTime.toFixed(3)} s`}
        </span>
      </div>
      {ready && (
        <>
          <div class="dev-row">
            <SegmentedControl
              label="Axis"
              value={axis}
              options={[
                { value: 'time', label: 'Time' },
                { value: 'distance', label: 'Distance' },
              ]}
              onChange={(v) => setAxis(v)}
            />
            <SegmentedControl
              label="Surface levers"
              value={levers}
              options={[
                { value: '2', label: '2 levers' },
                { value: '1', label: '1 lever (A1)' },
              ]}
              onChange={(v) => setLevers(v)}
            />
            <SegmentedControl
              label="Surface"
              value={surface}
              options={[
                { value: 'on', label: 'Surface on' },
                { value: 'off', label: 'Off' },
              ]}
              onChange={(v) => setSurface(v)}
            />
            <Button onClick={() => setWaterfall('speed')} data-testid="open-waterfall-speed">
              Waterfall: speed
            </Button>
          </div>
          <div style={{ height: '360px', overflow: 'auto', border: '1px solid var(--line)' }}>
            <StripStack
              current={current?.telemetry ?? null}
              best={best && best !== current ? best.telemetry : null}
              strips={strips}
              onStripsChange={setStrips}
              availableIds={available}
              axis={axis}
              units={units}
              gutterMenu={gutterMenu}
            />
          </div>
          <div class="dev-row micro dim">
            {`toggle a channel: `}
            {['long_g', 'wheel_speed_rl', 'mu_rear'].map((id) => (
              <button
                key={id}
                type="button"
                class="dev-link"
                style={{ background: 'none', border: 0 }}
                onClick={() => setStrips((s) => toggleStrip(s, id))}
              >
                {id}
              </button>
            ))}
          </div>
          {surface === 'on' && surfaceInput && (
            <div style={{ height: '520px' }}>
              <ResponseSurfacePanel
                grid={surfaceInput.grid}
                runs={ready.runs}
                level={surfaceInput.level}
                units={units}
              />
            </div>
          )}
          {waterfall && (
            <WaterfallOverlay
              runs={ready.runs}
              channel={waterfall}
              units={units}
              axis={axis}
              slot={Math.max(0, strips.indexOf(waterfall))}
              levers={ready.level.levers}
              onClose={() => setWaterfall(null)}
            />
          )}
        </>
      )}
    </section>
  );
}
