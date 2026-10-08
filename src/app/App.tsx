/**
 * The app shell: top bar (wordmark, breadcrumb, run pips, Units, Axis, ⌘K, ⓘ), hash routes
 * (`#/`, `#/level/:id`, `#/level/:id/debrief`, `#/dev/*`), the global keyboard map
 * (design-system "Keyboard map"), the command palette, the shortcut sheet, and an error boundary
 * that replaces the route with the fault panel.
 */
import { Component, type ComponentChildren } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import { axisMode, projectorMode, units } from '@/game/prefs';
import { LEVELS, getLevel } from '@/levels/index';
import type { LevelId } from '@/levels/types';
import { RunPips } from '@/report/RunPips';
import { Debrief } from '@/debrief/Debrief';
import { paletteOpen, shortcutsOpen, workbenchActions } from './actions';
import { CommandPalette, type Command } from './CommandPalette';
import { TopBar } from './components/TopBar';
import { Modal } from './components/Modal';
import { FaultPanel, type FaultInfo } from './FaultPanel';
import {
  existingLevelState,
  levelState,
  nextLevel,
  progress,
  retryLevel,
  unlocked,
} from './game-store';
import { LevelSelect } from './LevelSelect';
import { log } from './log';
import { levelPath, navigate, parseRoute, routePath, type Route } from './router';
import { DevHome } from './routes/DevHome';
import { DevReport } from './routes/DevReport';
import { DevWorker } from './routes/DevWorker';
import { Workbench } from './Workbench';
import './App.css';
import './screens.css';

// ---- Error boundary → fault panel ----

class Boundary extends Component<
  { children: ComponentChildren; resetKey: string },
  { fault: FaultInfo | null; key: string }
> {
  override state = { fault: null as FaultInfo | null, key: this.props.resetKey };
  static override getDerivedStateFromProps(
    props: { resetKey: string },
    state: { fault: FaultInfo | null; key: string },
  ) {
    return props.resetKey !== state.key ? { fault: null, key: props.resetKey } : null;
  }
  override componentDidCatch(error: unknown) {
    log.error('render error', error);
    this.setState({ fault: { error, context: 'render' } });
  }
  override render() {
    if (this.state.fault) {
      return (
        <div class="screen-fault">
          <FaultPanel
            fault={this.state.fault}
            onDismiss={() => this.setState({ fault: null })}
            dismissLabel="Try again"
          />
        </div>
      );
    }
    return this.props.children;
  }
}

// ---- Routes ----

function DebriefRoute({ id }: { id: LevelId }) {
  const level = getLevel(id)!;
  const st = existingLevelState(id);
  const next = nextLevel(id);
  return (
    <Debrief
      level={level}
      session={st?.session ?? null}
      hintOpens={st?.hintOpens.value ?? {}}
      stored={progress.value[id] ?? null}
      units={units.value}
      onRetry={() => {
        retryLevel(id);
        navigate(levelPath(id));
      }}
      onNext={next && unlocked(next.id) ? () => navigate(levelPath(next.id)) : null}
      onLevelSelect={() => navigate('/')}
    />
  );
}

function Locked({ id }: { id: LevelId }) {
  return (
    <section class="screen-msg" data-testid="locked">
      <h1 class="h1">{`${id} is locked`}</h1>
      <p class="dim">Levels unlock in order. Finish the level before it first.</p>
      <a class="sheet__link" href="#/">
        Level select
      </a>
    </section>
  );
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'select':
      return <LevelSelect units={units.value} />;
    case 'level':
      return unlocked(route.id) ? (
        <Workbench key={route.id} levelId={route.id} units={units.value} />
      ) : (
        <Locked id={route.id} />
      );
    case 'debrief':
      return unlocked(route.id) ? <DebriefRoute id={route.id} /> : <Locked id={route.id} />;
    case 'dev':
      if (route.path === '/dev/worker') return <DevWorker />;
      if (route.path === '/dev/report')
        return <DevReport units={units.value} onUnitsChange={(next) => (units.value = next)} />;
      return <DevHome units={units.value} />;
    default:
      return (
        <section class="screen-msg">
          <h1 class="h1">Nothing here</h1>
          <p class="dim mono">{route.path}</p>
          <a class="sheet__link" href="#/">
            Level select
          </a>
        </section>
      );
  }
}

// ---- Keyboard map ----

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

function useKeyboardMap(phaseB: boolean) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        paletteOpen.value = !paletteOpen.value;
        return;
      }
      if (mod && ev.key === 'Enter') {
        ev.preventDefault();
        workbenchActions.value?.run();
        return;
      }
      if (mod || ev.altKey || isTyping(ev.target)) return;
      if (paletteOpen.value || shortcutsOpen.value) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      switch (ev.key) {
        case 'r':
        case 'R':
          if (workbenchActions.value) {
            ev.preventDefault();
            workbenchActions.value.run();
          }
          return;
        case 'h':
        case 'H':
          if (workbenchActions.value) {
            ev.preventDefault();
            workbenchActions.value.toggleHint();
          }
          return;
        case 'u':
        case 'U':
          units.value = units.value === 'metric' ? 'imperial' : 'metric';
          return;
        case 'x':
        case 'X':
          if (phaseB) axisMode.value = axisMode.value === 'time' ? 'distance' : 'time';
          return;
        case 'p':
        case 'P':
          projectorMode.value = !projectorMode.value;
          return;
        case '?':
          shortcutsOpen.value = true;
          return;
        default:
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phaseB]);
}

const SHORTCUTS: Array<[string, string]> = [
  ['R  /  ⌘⏎', 'Run'],
  ['H', 'Hint popover (1/2/3 arm a tier, press again to open it)'],
  ['/', 'Focus the channel filter'],
  ['↑ ↓', 'Move strip selection;  ⌥↑ ⌥↓ reorder;  Del remove'],
  ['← →', 'Step the pinned cursor, or the focused lever'],
  ['Space', 'Replay (track view)'],
  ['Esc', 'Unpin cursor, close popover'],
  ['U  /  X', 'Units  /  axis (Phase B)'],
  ['P', 'Projector mode'],
  ['⌘K', 'Command palette'],
  ['?', 'This sheet'],
];

function ShortcutSheet() {
  return (
    <Modal label="Keyboard shortcuts" onClose={() => (shortcutsOpen.value = false)} width={480}>
      <div class="shortcuts">
        <h2 class="h2 dim">Keyboard</h2>
        <dl>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} class="shortcuts__row">
              <dt class="mono">{k}</dt>
              <dd class="dim">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}

function usePaletteCommands(route: Route): Command[] {
  const wb = workbenchActions.value;
  return useMemo(() => {
    const cmds: Command[] = LEVELS.map((l) => ({
      id: `level:${l.id}`,
      group: 'Level',
      label: `${l.id} ${l.title}: ${l.concept}`,
      hint: unlocked(l.id) ? undefined : 'locked',
      disabled: !unlocked(l.id),
      run: () => navigate(levelPath(l.id)),
    }));
    cmds.push(
      { id: 'select', group: 'Level', label: 'Level select', run: () => navigate('/') },
      {
        id: 'projector',
        group: 'View',
        label: `Projector mode ${projectorMode.value ? 'off' : 'on'}`,
        hint: 'P',
        run: () => (projectorMode.value = !projectorMode.value),
      },
      {
        id: 'units',
        group: 'View',
        label: `Units: ${units.value === 'metric' ? 'imperial' : 'metric'}`,
        hint: 'U',
        run: () => (units.value = units.value === 'metric' ? 'imperial' : 'metric'),
      },
      {
        id: 'axis',
        group: 'View',
        label: `Axis: ${axisMode.value === 'time' ? 'distance' : 'time'}`,
        hint: 'X · Phase B',
        disabled: true,
        run: () => (axisMode.value = axisMode.value === 'time' ? 'distance' : 'time'),
      },
      {
        id: 'keys',
        group: 'View',
        label: 'Keyboard shortcuts',
        hint: '?',
        run: () => (shortcutsOpen.value = true),
      },
    );
    if (wb) {
      for (const id of [...wb.channels].sort()) {
        cmds.push({
          id: `ch:${id}`,
          group: 'Channel',
          label: id,
          hint: wb.inStack.has(id) ? 'in stack' : 'add',
          run: () => wb.addChannel(id),
        });
      }
    }
    return cmds;
    // Recompute when the palette opens.
  }, [paletteOpen.value, route, wb]);
}

export function App() {
  const route = parseRoute(routePath.value);
  const levelId = route.name === 'level' || route.name === 'debrief' ? route.id : null;
  const level = levelId ? getLevel(levelId) : undefined;
  const phaseB = level?.phase === 'B';
  useKeyboardMap(phaseB);
  const commands = usePaletteCommands(route);

  const st = route.name === 'level' && levelId && unlocked(levelId) ? levelState(levelId) : null;
  const s = st?.session;

  return (
    <div class="app">
      <TopBar
        units={units.value}
        onUnitsChange={(next) => (units.value = next)}
        axis={phaseB ? axisMode.value : 'time'}
        onAxisChange={(next) => (axisMode.value = next)}
        axisEnabled={phaseB}
        onPalette={() => (paletteOpen.value = true)}
        {...(route.name === 'level' && workbenchActions.value
          ? { onBrief: () => workbenchActions.value?.openBrief() }
          : {})}
        pips={
          s ? (
            <RunPips
              budget={s.level.runBudget}
              usedByRuns={s.runs.value.length}
              usedByHints={s.runsUsed.value - s.runs.value.length}
            />
          ) : undefined
        }
      >
        {level && (
          <>
            <a class="topbar__crumb-level" href={`#${levelPath(level.id)}`}>
              {`${level.id} · ${level.title}`}
            </a>
            {route.name === 'debrief' && <span class="micro dim">/ debrief</span>}
          </>
        )}
      </TopBar>
      <main class="app__main">
        <Boundary resetKey={routePath.value}>
          <RouteView route={route} />
        </Boundary>
      </main>
      {paletteOpen.value && (
        <CommandPalette commands={commands} onClose={() => (paletteOpen.value = false)} />
      )}
      {shortcutsOpen.value && <ShortcutSheet />}
    </div>
  );
}
