/**
 * `/#/dev/report`: the report gallery. Renders every Stage 4 component from fixtures in the
 * design-system workbench layout (setup · stack · track view + channel table), with toggles for
 * units, axis, channel count (12/40/200), projector mode, colour-by and the history overlay.
 * Below the workbench: header, pips and hint states.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ChannelId } from '@/engine/types';
import type { HintText } from '@/hints/types';
import { interpAt } from '@/report/align';
import { ChannelTable } from '@/report/ChannelTable';
import { cursorIdx, resetCursor } from '@/report/cursor-store';
import { HintPopover } from '@/report/HintPopover';
import { LockGlyph } from '@/report/LockGlyph';
import { setProjector, useProjectorMode } from '@/report/projector';
import { ResultHeader } from '@/report/ResultHeader';
import { RunCount } from '@/report/RunCount';
import { selectedStrip } from '@/report/selection';
import { StripStack } from '@/report/StripStack';
import { toggleStrip } from '@/report/strip-ops';
import { TrackView } from '@/report/TrackView';
import { PlaybackControls } from '@/report/PlaybackControls';
import { setPlaySpeed, startPlayback } from '@/report/playback';
import {
  FIXTURE_HINTS,
  FIXTURE_LEVERS,
  FIXTURE_LOCKED,
  FIXTURE_SETUP,
  installFixtureChannelMeta,
  makeReportFixture,
  type FixtureSize,
} from '@/report/__fixtures__';
import type { UnitSystem } from '@/units';
import { formatValue } from '@/units';
import { Button } from '../components/Button';
import { SegmentedControl } from '../components/SegmentedControl';
import './DevReport.css';

installFixtureChannelMeta();

const DEFAULT_STRIPS: ChannelId[] = [
  'speed',
  'long_g',
  'lat_g',
  'engine_rpm',
  'wheel_speed_rl',
  'rear_slip_ratio',
  'clutch_temp', // not logged on this level: placeholder row
];

const DIRECT_HINT: HintText = {
  text: 'Lengthen the throttle ramp.',
  segments: [{ kind: 'text', value: 'Lengthen the throttle ramp.' }],
};

const RUNS_USED = 3;

type OnOff = 'off' | 'on';

/** Reads the cursor signal in its own component so hovering re-renders only this span. */
function CursorStat() {
  return (
    <span class="devr__stat micro faint" data-testid="dev-cursor">
      {`cursor ${cursorIdx.value ?? '—'}`}
    </span>
  );
}

export interface DevReportProps {
  units: UnitSystem;
  onUnitsChange(next: UnitSystem): void;
}

export function DevReport({ units, onUnitsChange }: DevReportProps) {
  const [size, setSize] = useState<FixtureSize>(12);
  const [axis, setAxis] = useState<'time' | 'distance'>('time');
  const [colour, setColour] = useState<OnOff>('on');
  const [history, setHistory] = useState<OnOff>('off');
  const [strips, setStrips] = useState<ChannelId[]>(DEFAULT_STRIPS);
  const [tiers, setTiers] = useState(2);
  const [flash, setFlash] = useState<ChannelId | null>(null);
  const projector = useProjectorMode();

  const fx = useMemo(() => makeReportFixture(size), [size]);
  const available = useMemo(() => new Set(fx.ids), [fx]);
  const inStack = useMemo(() => new Set(strips), [strips]);

  useEffect(() => {
    if (selectedStrip.value === null) selectedStrip.value = 'lat_g';
    return () => {
      resetCursor();
      setProjector(false);
    };
  }, []);

  // Segment boundaries in SI axis units: metres, or the current run's time at those metres.
  const boundaries = useMemo(() => {
    const starts = fx.segmentStartsS.slice(1);
    return axis === 'distance'
      ? starts
      : starts.map((s) => interpAt(fx.current.s, fx.current.t, s));
  }, [fx, axis]);

  const texts = [...FIXTURE_HINTS, DIRECT_HINT].slice(0, tiers);
  const hintWindow = tiers > 0 ? { channel: 'rear_slip_ratio', tStart: 0.3, tEnd: 1.1 } : null;

  const onChannelClick = (id: ChannelId) => {
    if (!strips.includes(id)) setStrips([...strips, id]);
    setFlash(null);
    queueMicrotask(() => setFlash(id));
  };

  const run = {
    index: 3,
    time: fx.currentTime,
    setup: FIXTURE_SETUP,
    changed: ['throttle_ramp' as const],
  };

  return (
    <div class="devr" data-testid="dev-report">
      <div class="devr__bar">
        <span class="h2 dim">Dev · Report</span>
        <SegmentedControl
          label="Units"
          compact
          options={[
            { value: 'metric', label: 'Metric' },
            { value: 'imperial', label: 'Imperial' },
          ]}
          value={units}
          onChange={onUnitsChange}
        />
        <SegmentedControl
          label="Axis"
          compact
          options={[
            { value: 'time', label: 'Time' },
            { value: 'distance', label: 'Dist' },
          ]}
          value={axis}
          onChange={(v) => setAxis(v)}
        />
        <SegmentedControl
          label="Channels"
          compact
          options={[
            { value: '12', label: '12 ch' },
            { value: '40', label: '40 ch' },
            { value: '200', label: '200 ch' },
          ]}
          value={String(size) as '12' | '40' | '200'}
          onChange={(v) => setSize(Number(v) as FixtureSize)}
        />
        <SegmentedControl
          label="Projector"
          compact
          options={[
            { value: 'off', label: 'Proj off' },
            { value: 'on', label: 'Proj on' },
          ]}
          value={projector ? 'on' : 'off'}
          onChange={(v) => setProjector(v === 'on')}
        />
        <SegmentedControl
          label="Colour by"
          compact
          options={[
            { value: 'off', label: 'Colour off' },
            { value: 'on', label: 'Colour on' },
          ]}
          value={colour}
          onChange={(v) => setColour(v)}
        />
        <SegmentedControl
          label="History"
          compact
          options={[
            { value: 'off', label: 'Hist off' },
            { value: 'on', label: 'Hist on' },
          ]}
          value={history}
          onChange={(v) => setHistory(v)}
        />
        <CursorStat />
      </div>

      <div class="devr__wb">
        <aside class="devr__setup" aria-label="Setup">
          <div class="devr__setup-head">
            <h2 class="h2 dim">Setup</h2>
            <RunCount runs={RUNS_USED} hints={tiers} />
          </div>
          <dl class="devr__levers data">
            {FIXTURE_LEVERS.map((l) => (
              <div key={l.id} class="devr__lever">
                <dt>{l.label}</dt>
                <dd>{formatValue(l.quantity, units, FIXTURE_SETUP[l.id])}</dd>
              </div>
            ))}
            <div class="devr__lever devr__lever--locked">
              <dt>
                Weight dist <LockGlyph />
              </dt>
              <dd>{formatValue('fraction', units, FIXTURE_LOCKED.weight_dist ?? 0)}</dd>
            </div>
            <div class="devr__lever devr__lever--locked">
              <dt>
                Wing <LockGlyph />
              </dt>
              <dd>{formatValue('angle_int', units, FIXTURE_LOCKED.wing ?? 0)}</dd>
            </div>
          </dl>
          <div class="devr__setup-foot">
            <HintPopover
              tiersOpened={tiers}
              texts={texts}
              onOpenNext={() => setTiers((t) => Math.min(3, t + 1))}
              onChannelClick={onChannelClick}
            />
            <div class="devr__hintrow">
              <span class="h2 dim">Hint</span>
              {[0, 1, 2].map((i) => (
                <Button
                  key={i}
                  variant="hint"
                  size="compact"
                  pressed={i < tiers}
                  disabled={i > tiers}
                >
                  {String(i + 1)}
                </Button>
              ))}
              <Button variant="ghost" size="compact" onClick={() => setTiers(0)}>
                reset
              </Button>
            </div>
            <Button variant="primary" size="run" class="devr__run">
              Run ⏎
            </Button>
          </div>
        </aside>

        <div class="devr__center">
          <ResultHeader
            run={run}
            bestTime={fx.bestTime}
            target={fx.bestTime - 0.05}
            isPB={false}
            passed={false}
            lockedLevers={FIXTURE_LOCKED}
            levers={FIXTURE_LEVERS}
            units={units}
          />
          <div class="devr__stack">
            <StripStack
              current={fx.current}
              best={fx.best}
              history={history === 'on' ? fx.history : undefined}
              strips={strips}
              onStripsChange={setStrips}
              availableIds={available}
              axis={axis}
              segmentBoundaries={boundaries}
              segmentLabels={fx.segmentLabels}
              hintWindow={hintWindow}
              units={units}
              flashChannel={flash}
            />
          </div>
        </div>

        <aside class="devr__right" aria-label="Track and channels">
          <div class="devr__playback">
            <PlaybackControls
              canReplay
              onReplay={() =>
                startPlayback({
                  runIndex: 1,
                  n: fx.current.n,
                  dt: fx.current.dt,
                  gating: false,
                })
              }
              onSpeed={setPlaySpeed}
            />
          </div>
          <TrackView
            geometry={fx.track}
            current={fx.current}
            best={fx.best}
            colorBy={colour === 'on' ? selectedStrip.value : null}
            segmentLabels={fx.segmentLabels}
            units={units}
            axis={axis}
          />
          <div class="devr__table">
            <ChannelTable
              ids={fx.ids}
              current={fx.currentSummary}
              best={fx.bestSummary}
              inStack={inStack}
              onToggle={(id) => setStrips((s) => toggleStrip(s, id))}
              units={units}
            />
          </div>
        </aside>
      </div>

      <section class="devr__gallery" aria-label="Component states">
        <h2 class="h2 dim">States</h2>
        <div class="devr__card">
          <span class="micro faint">ResultHeader · PB + target met + compromise gap</span>
          <ResultHeader
            run={{
              index: 5,
              time: fx.bestTime,
              setup: FIXTURE_SETUP,
              changed: ['throttle_ramp', 'tire_pressure'],
            }}
            bestTime={fx.currentTime}
            target={fx.bestTime + 0.02}
            isPB
            passed
            lockedLevers={FIXTURE_LOCKED}
            levers={FIXTURE_LEVERS}
            extra={[{ label: 'gap', value: '+0.184 s', tone: 'loss' }]}
            units={units}
            onDebrief={() => undefined}
          />
        </div>
        <div class="devr__card">
          <span class="micro faint">ResultHeader · no run</span>
          <ResultHeader
            run={null}
            bestTime={null}
            target={null}
            isPB={false}
            passed={false}
            lockedLevers={{}}
            levers={FIXTURE_LEVERS}
            units={units}
          />
        </div>
        <div class="devr__row">
          <div class="devr__card devr__card--small">
            <span class="micro faint">RunCount · fresh / runs / hints</span>
            <RunCount runs={0} hints={0} />
            <RunCount runs={4} hints={0} />
            <RunCount runs={5} hints={3} />
          </div>
          <div class="devr__card devr__card--small">
            <span class="micro faint">HintPopover · one tier open</span>
            <HintPopover
              tiersOpened={1}
              texts={FIXTURE_HINTS.slice(0, 1)}
              onOpenNext={() => undefined}
              onChannelClick={onChannelClick}
            />
          </div>
          <div class="devr__card devr__card--small">
            <span class="micro faint">HintPopover · none opened</span>
            <HintPopover
              tiersOpened={0}
              texts={[]}
              onOpenNext={() => undefined}
              onChannelClick={onChannelClick}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
