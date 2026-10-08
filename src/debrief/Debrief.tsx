/**
 * Debrief (design-system "Other screens: Debrief"; core loop step 7): a full-screen route in three
 * columns:
 *   1. result + the run-by-run convergence table (run, setup chips, time, Δtarget, hints);
 *   2. the causal channels' strips across all runs (`StripStack` with `history`);
 *   3. the physics in two sentences, the optimal setup beside the player's best, every rule that
 *      fired (all tiers, free) as an accordion, then the response-surface slot for Stage 7.
 *
 * This is the first place roles are revealed: the causal channels are named here.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Button } from '@/app/components/Button';
import { RichText } from '@/app/components/RichText';
import type { ChannelId, LeverId, Setup } from '@/engine/types';
import { scoreOf } from '@/game/progress';
import type { LevelSession, RunRecord } from '@/game/types';
import { renderTier, ruleFor } from '@/hints/engine';
import type { HintMatch } from '@/hints/types';
import type { LevelConfig } from '@/levels/types';
import { DeltaValue } from '@/report/DeltaValue';
import { LEVER_QUANTITY, LEVER_SHORT } from '@/report/ResultHeader';
import { StripStack } from '@/report/StripStack';
import { TIER_LABELS } from '@/report/HintPopover';
import { formatValue, unitLabel, type UnitSystem } from '@/units';
import './debrief.css';

export interface DebriefProps {
  level: LevelConfig;
  /** Null when the session is gone (e.g. after a reload): the stored progress is shown instead. */
  session: LevelSession | null;
  /** Hint tiers opened, keyed by the run index they followed. */
  hintOpens: Record<number, number>;
  stored: { passed: boolean; bestTime: number | null; bestScore: number | null } | null;
  units: UnitSystem;
  onRetry(): void;
  onNext: (() => void) | null;
  onLevelSelect(): void;
  /**
   * STAGE 7 SLOT: the three.js response surface (lever × lever → time, player runs as dots, the
   * optimum as a diamond). Stage 7 passes its lazy component here; until then a placeholder shows.
   */
  responseSurface?: ComponentChildren;
}

const LEVER_ORDER: LeverId[] = ['throttle_ramp', 'tire_pressure', 'weight_dist', 'wing'];

function SetupChips({
  level,
  setup,
  units,
}: {
  level: LevelConfig;
  setup: Setup;
  units: UnitSystem;
}) {
  return (
    <span class="db__chips">
      {level.levers.map((l) => (
        <span key={l.id} class="setchip data">
          <span class="setchip__name">{LEVER_SHORT[l.id]}</span>{' '}
          {formatValue(l.quantity, units, setup[l.id])}
        </span>
      ))}
    </span>
  );
}

interface FiredRule {
  ruleId: string;
  runs: number[];
  match: HintMatch;
}

function firedRules(runs: RunRecord[]): FiredRule[] {
  const by = new Map<string, FiredRule>();
  for (const r of runs) {
    for (const h of r.hints) {
      const f = by.get(h.ruleId);
      if (f) {
        f.runs.push(r.index);
        f.match = h;
      } else by.set(h.ruleId, { ruleId: h.ruleId, runs: [r.index], match: h });
    }
  }
  return [...by.values()];
}

export function Debrief({
  level,
  session,
  hintOpens,
  stored,
  units,
  onRetry,
  onNext,
  onLevelSelect,
  responseSurface,
}: DebriefProps) {
  const runs = session?.runs.value ?? [];
  const grid = session?.grid.value ?? null;
  const best = session?.best.value ?? null;
  const status = session?.status.value ?? null;
  const passed = status === 'passed' || (!session && !!stored?.passed);
  const [strips, setStrips] = useState<ChannelId[]>(level.debrief.causal);
  const available = useMemo(() => new Set(level.channelSet), [level]);
  const fired = useMemo(() => firedRules(runs), [runs]);
  const [openRule, setOpenRule] = useState<string | null>(null);
  const hintsSpent = Object.values(hintOpens).reduce((a, b) => a + b, 0);
  const firstPass = grid ? runs.find((r) => r.outcome.totalTime <= grid.target) : undefined;

  const summary = passed
    ? firstPass
      ? `Target met in ${firstPass.index} run${firstPass.index === 1 ? '' : 's'}${hintsSpent ? `, ${hintsSpent} hint tier${hintsSpent === 1 ? '' : 's'} opened` : ''}.`
      : 'Target met.'
    : runs.length > 0
      ? `Target not met in ${level.runBudget} runs.`
      : 'No runs in this session.';

  return (
    <section class="db" data-testid="debrief">
      <header class="db__head">
        <div>
          <span class="micro dim">{`${level.id} · DEBRIEF`}</span>
          <h1 class="h1">{level.title}</h1>
        </div>
        <div class="db__actions">
          <Button variant="ghost" onClick={onLevelSelect}>
            Level select
          </Button>
          <Button variant="secondary" onClick={onRetry} data-testid="retry">
            Retry level
          </Button>
          {onNext && (
            <Button variant="primary" onClick={onNext} data-testid="next-level">
              Continue
            </Button>
          )}
        </div>
      </header>

      <div class="db__grid">
        {/* ---- Column 1: result + convergence ---- */}
        <div class="db__col">
          <div class="db__result">
            <span
              class={`db__status chip ${passed ? 'chip--best' : ''}`}
              data-testid="debrief-status"
            >
              {passed ? 'TARGET' : 'NOT MET'}
            </span>
            <p data-testid="debrief-summary">{summary}</p>
            <dl class="db__kv data">
              <dt class="dim">best</dt>
              <dd>
                {best
                  ? formatValue('time', units, best.outcome.totalTime)
                  : stored?.bestTime != null
                    ? formatValue('time', units, stored.bestTime)
                    : '—'}
              </dd>
              <dt class="dim">target</dt>
              <dd>{grid ? formatValue('time', units, grid.target) : '—'}</dd>
              <dt class="dim">score</dt>
              <dd>
                {session
                  ? `${scoreOf(session)} run${scoreOf(session) === 1 ? '' : 's'} left`
                  : stored?.bestScore != null
                    ? `${stored.bestScore} runs left`
                    : '—'}
              </dd>
            </dl>
          </div>
          <h2 class="h2 dim db__h">Convergence</h2>
          <div class="db__tablewrap">
            <table class="db__table" data-testid="convergence">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Setup</th>
                  <th class="db__r">Time</th>
                  <th class="db__r">Δ target</th>
                  <th class="db__r">Hints</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={5} class="micro faint">
                      Runs live in memory for the session; this one has none.
                    </td>
                  </tr>
                )}
                {runs.map((r) => (
                  <tr key={r.index} class={r === best ? 'db__best' : ''}>
                    <td class="mono">{r.index}</td>
                    <td>
                      <SetupChips level={level} setup={r.setup} units={units} />
                    </td>
                    <td class="db__r mono">
                      {formatValue('time', units, r.outcome.totalTime, { withUnit: false })}
                    </td>
                    <td class="db__r">
                      <DeltaValue
                        value={grid ? r.outcome.totalTime - grid.target : null}
                        size="data"
                      />
                    </td>
                    <td class="db__r mono">{hintOpens[r.index] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="micro faint">{`Times in ${unitLabel('time', units)}. Hints = tiers opened after that run.`}</p>
        </div>

        {/* ---- Column 2: causal strips across all runs ---- */}
        <div class="db__col db__col--strips">
          <h2 class="h2 dim db__h">Channels that mattered</h2>
          <p class="db__causal">
            {level.debrief.causal.map((id) => (
              <code key={id} class="mono db__chan">
                {id}
              </code>
            ))}
          </p>
          <div class="db__stack">
            {best ? (
              <StripStack
                current={best.telemetry}
                best={null}
                history={runs.filter((r) => r !== best).map((r) => r.telemetry)}
                strips={strips}
                onStripsChange={setStrips}
                availableIds={available}
                axis="time"
                units={units}
              />
            ) : (
              <p class="micro faint">No runs to draw.</p>
            )}
          </div>
          <p class="micro faint">Your best run in colour; every other run underneath in grey.</p>
        </div>

        {/* ---- Column 3: physics, optimum, rules, surface ---- */}
        <div class="db__col">
          <h2 class="h2 dim db__h">Physics</h2>
          {level.debrief.physics.map((p, i) => (
            <RichText key={i} class="db__prose" text={p} units={units} />
          ))}

          <h2 class="h2 dim db__h">Optimal setup</h2>
          <table class="db__table db__opt" data-testid="optimal">
            <thead>
              <tr>
                <th>Lever</th>
                <th class="db__r">Optimal</th>
                <th class="db__r">Your best</th>
              </tr>
            </thead>
            <tbody>
              {LEVER_ORDER.filter((id) => level.levers.some((l) => l.id === id)).map((id) => (
                <tr key={id}>
                  <td>{LEVER_SHORT[id]}</td>
                  <td class="db__r mono db__optv">
                    {grid ? formatValue(LEVER_QUANTITY[id], units, grid.optimum.setup[id]) : '—'}
                  </td>
                  <td class="db__r mono">
                    {best ? formatValue(LEVER_QUANTITY[id], units, best.setup[id]) : '—'}
                  </td>
                </tr>
              ))}
              <tr>
                <td class="dim">time</td>
                <td class="db__r mono db__optv">
                  {grid ? formatValue('time', units, grid.optimum.outcome.totalTime) : '—'}
                </td>
                <td class="db__r mono">
                  {best ? formatValue('time', units, best.outcome.totalTime) : '—'}
                </td>
              </tr>
            </tbody>
          </table>

          <h2 class="h2 dim db__h">Rules that fired</h2>
          {fired.length === 0 && <p class="micro faint">No rule fired on any run.</p>}
          <ul class="db__rules">
            {fired.map((f) => {
              const rule = ruleFor(level, f.match);
              if (!rule) return null;
              const open = openRule === f.ruleId;
              return (
                <li key={f.ruleId} class="db__rule">
                  <button
                    type="button"
                    class="db__rulehead"
                    aria-expanded={open}
                    onClick={() => setOpenRule(open ? null : f.ruleId)}
                  >
                    <span class="mono">{f.ruleId}</span>
                    <span class={`micro ${rule.kind === 'fault' ? 'db__fault' : 'dim'}`}>
                      {rule.kind}
                    </span>
                    <span class="micro dim db__ruleruns">{`run ${f.runs.join(', ')}`}</span>
                    <span class="micro dim" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                  </button>
                  {open && (
                    <div class="db__rulebody">
                      {[0, 1, 2].map((t) => {
                        const txt = renderTier(rule, f.match, t as 0 | 1 | 2, units);
                        return (
                          <div key={t} class="hint__tier">
                            <h3 class="h2 hint__label">
                              <span class="micro faint">{t + 1}</span> {TIER_LABELS[t]}
                            </h3>
                            <p class="hint__text">
                              {txt.segments.map((s, i) =>
                                s.kind === 'channel' ? (
                                  <code key={i} class="mono rich__channel">
                                    {s.value}
                                  </code>
                                ) : s.kind === 'value' ? (
                                  <span key={i} class="hint__value mono">
                                    {s.value}
                                  </span>
                                ) : (
                                  <span key={i}>{s.value}</span>
                                ),
                              )}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <h2 class="h2 dim db__h">Response surface</h2>
          <div class="db__surface" data-testid="response-surface-slot">
            {responseSurface ?? (
              <p class="micro faint">
                The response surface (time over the two most influential levers, with your runs on
                it) renders here.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
