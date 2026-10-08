/**
 * Result header, run count, hint body and the docked hint box (Stage 10: no run budget, free
 * hints, sign + "faster"/"slower" deltas, labelled PB / TARGET MET chips, live playback cells).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeverId, Setup } from '@/engine/types';
import { lastAnnouncement, runAnnouncement } from '@/report/a11y';
import { DeltaValue, deltaParts, deltaWord } from '@/report/DeltaValue';
import { HintPopover } from '@/report/HintPopover';
import { playhead } from '@/report/playback';
import { ResultHeader } from '@/report/ResultHeader';
import { RunCount, runCountText } from '@/report/RunCount';
import {
  FIXTURE_HINTS,
  FIXTURE_LEVERS,
  FIXTURE_LOCKED,
  makeReportFixture,
} from '@/report/__fixtures__';
import type { ResultHeaderProps } from '@/report/types';
import { HintControls } from '@/setup/HintControls';

afterEach(() => {
  cleanup();
  playhead.value = null;
});

const SETUP: Setup = { throttle_ramp: 0.4, tire_pressure: 1.7, weight_dist: 0.45, wing: 4 };

function header(over: Partial<ResultHeaderProps> = {}) {
  const props: ResultHeaderProps = {
    run: { index: 3, time: 14.732, setup: SETUP, changed: ['throttle_ramp'] as LeverId[] },
    bestTime: 14.943,
    target: 14.648,
    isPB: false,
    passed: false,
    lockedLevers: FIXTURE_LOCKED,
    levers: FIXTURE_LEVERS,
    units: 'metric',
    runs: 3,
    hints: 1,
    ...over,
  };
  return render(<ResultHeader {...props} />);
}

describe('DeltaValue', () => {
  it('faster is − in gain with the word "faster"; slower is + in loss with "slower"; zero is neutral', () => {
    expect(deltaParts(-0.142)).toEqual({ glyph: '▼', text: '−0.142', tone: 'gain' });
    expect(deltaParts(0.087)).toEqual({ glyph: '▲', text: '+0.087', tone: 'loss' });
    expect(deltaParts(0.0001).tone).toBe('even');
    expect(deltaWord('gain')).toBe('faster');
    expect(deltaWord('loss')).toBe('slower');
    render(<DeltaValue value={-0.211} label="best" unit="s" />);
    const el = document.querySelector('.delta') as HTMLElement;
    expect(el.classList.contains('delta--gain')).toBe(true);
    expect(el.textContent).toContain('−0.211');
    expect(el.textContent).toContain('faster');
    expect(el.getAttribute('aria-label')).toBe('0.211 s faster than best');
  });

  it('the compact table size keeps the glyph', () => {
    render(<DeltaValue value={0.05} size="data" />);
    expect(document.querySelector('.delta')!.textContent).toContain('▲+0.050');
  });
});

describe('ResultHeader', () => {
  it('shows the time, Δbest faster and Δtarget slower with sign, word and tone', () => {
    header();
    expect(screen.getByTestId('rh-time').textContent).toContain('14.732');
    const deltas = [...document.querySelectorAll<HTMLElement>('.delta')];
    expect(deltas[0]!.dataset['tone']).toBe('gain');
    expect(deltas[0]!.textContent).toContain('−0.211');
    expect(deltas[0]!.textContent).toContain('faster');
    expect(deltas[1]!.dataset['tone']).toBe('loss');
    expect(deltas[1]!.textContent).toContain('+0.084');
    expect(deltas[1]!.textContent).toContain('slower');
    expect(screen.queryByTestId('chip-pb')).toBeNull();
    expect(screen.queryByTestId('chip-target')).toBeNull();
  });

  it('runs and hints instead of a budget', () => {
    header({ runs: 4, hints: 1 });
    const cell = screen.getByTestId('rh-runs');
    expect(cell.textContent).toContain('4');
    expect(cell.textContent).toContain('1 hint');
  });

  it('PB and TARGET MET are labelled chips (no purple); pass shows the debrief CTA', () => {
    const onDebrief = vi.fn();
    header({ isPB: true, passed: true, onDebrief });
    expect(screen.getByTestId('chip-pb').textContent).toBe('PB');
    expect(screen.getByTestId('chip-target').textContent).toBe('TARGET MET');
    expect(screen.getByTestId('chip-pb').classList.contains('chip--best')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to debrief' }));
    expect(onDebrief).toHaveBeenCalled();
  });

  it('underlines levers changed since the last run', () => {
    header();
    const ramp = document.querySelector('[data-lever="throttle_ramp"]') as HTMLElement;
    const pressure = document.querySelector('[data-lever="tire_pressure"]') as HTMLElement;
    expect(ramp.classList.contains('setchip--changed')).toBe(true);
    expect(ramp.textContent).toContain('ramp');
    expect(ramp.textContent).toContain('0.400 s');
    expect(pressure.classList.contains('setchip--changed')).toBe(false);
  });

  it('locked levers are faint chips with a lock', () => {
    header();
    const wd = document.querySelector('[data-lever="weight_dist"]') as HTMLElement;
    const wing = document.querySelector('[data-lever="wing"]') as HTMLElement;
    for (const chip of [wd, wing]) {
      expect(chip.classList.contains('setchip--locked')).toBe(true);
      expect(chip.getAttribute('aria-disabled')).toBe('true');
      expect(chip.querySelector('[aria-label="locked"]')).toBeTruthy();
    }
  });

  it('extra chips render with their tone', () => {
    header({ extra: [{ label: 'gap', value: '+0.184 s', tone: 'loss' }] });
    const chip = document.querySelector('.chip--extra') as HTMLElement;
    expect(chip.classList.contains('chip--loss')).toBe(true);
    expect(chip.textContent).toContain('+0.184 s');
  });

  it('announces the run through the aria-live region', () => {
    header();
    expect(lastAnnouncement()).toBe(
      'Run 3, 14.732 seconds, 0.211 faster than best, 0.084 over target.',
    );
    expect(runAnnouncement({ index: 1, time: 10, bestTime: null, target: 10.5 })).toBe(
      'Run 1, 10.000 seconds, 0.500 under target.',
    );
  });

  it('live playback: a counting time and speed; results hidden until the finish', () => {
    const fx = makeReportFixture(12);
    playhead.value = 100;
    header({ live: { index: 3, telemetry: fx.current }, isPB: true, passed: true });
    const t = screen.getByTestId('rh-live-time');
    expect(t.textContent).toContain(fx.current.t[100]!.toFixed(3));
    expect(screen.getByTestId('rh-live-speed').textContent).toContain('km/h');
    expect(screen.queryByTestId('rh-time')).toBeNull();
    expect(screen.queryByTestId('chip-pb')).toBeNull();
    expect(screen.queryByTestId('chip-target')).toBeNull();
    void act(() => {
      playhead.value = 400;
    });
    expect(screen.getByTestId('rh-live-time').textContent).toContain(fx.current.t[400]!.toFixed(3));
  });

  it('renders an empty state without a run', () => {
    header({ run: null });
    expect(screen.getByTestId('result-header').textContent).toContain('No run yet');
  });
});

describe('RunCount', () => {
  it('reads `RUNS n · h hints`, with the spoken label', () => {
    expect(runCountText({ runs: 4, hints: 1 })).toBe('RUNS 4 · 1 hint');
    expect(runCountText({ runs: 0, hints: 2 })).toBe('RUNS 0 · 2 hints');
    render(<RunCount runs={4} hints={1} />);
    const el = screen.getByTestId('run-count');
    expect(el.getAttribute('aria-label')).toBe('4 runs made, 1 hint opened');
    expect(el.textContent).toContain('RUNS4·1 hint');
  });
});

describe('HintPopover (free hints)', () => {
  function popover(over: Partial<Parameters<typeof HintPopover>[0]> = {}) {
    const onOpenNext = vi.fn();
    const onChannelClick = vi.fn();
    render(
      <HintPopover
        tiersOpened={1}
        texts={FIXTURE_HINTS.slice(0, 1)}
        onOpenNext={onOpenNext}
        onChannelClick={onChannelClick}
        {...over}
      />,
    );
    return { onOpenNext, onChannelClick };
  }

  it('one click opens the next tier: no confirm, no cost', () => {
    const { onOpenNext } = popover();
    const btn = screen.getByTestId('hint-open');
    expect(btn.textContent).toContain('Open explain');
    expect(btn.textContent).not.toContain('−');
    fireEvent.click(btn);
    expect(onOpenNext).toHaveBeenCalledTimes(1);
  });

  it('the tier number key opens it', () => {
    const { onOpenNext } = popover();
    fireEvent.keyDown(screen.getByTestId('hint-popover'), { key: '2' });
    expect(onOpenNext).toHaveBeenCalledTimes(1);
  });

  it('channel ids are clickable links; tier labels show', () => {
    const { onChannelClick } = popover();
    expect(screen.getByText(/Observe/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'rear_slip_ratio' }));
    expect(onChannelClick).toHaveBeenCalledWith('rear_slip_ratio');
  });

  it('no open button once all three tiers are open', () => {
    popover({ tiersOpened: 3 });
    expect(screen.queryByTestId('hint-open')).toBeNull();
  });
});

describe('HintControls (the docked, closable hint box)', () => {
  function box(over: Partial<Parameters<typeof HintControls>[0]> = {}) {
    const onOpenChange = vi.fn();
    const onOpenNext = vi.fn();
    render(
      <HintControls
        available
        tiersOpened={0}
        texts={[]}
        open
        onOpenChange={onOpenChange}
        onOpenNext={onOpenNext}
        onChannelClick={() => undefined}
        emptyReason="No run yet."
        hintsOpened={2}
        {...over}
      />,
    );
    return { onOpenChange, onOpenNext };
  }

  it('open: a docked panel with free · n opened and a close (×) button', () => {
    const { onOpenChange } = box();
    expect(screen.getByTestId('hint-box').textContent).toContain('free · 2 opened');
    fireEvent.click(screen.getByTestId('hint-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closed: a reopen control; `HINT · n new` when new rules fired', () => {
    const { onOpenChange } = box({ open: false, newCount: 2 });
    expect(screen.queryByTestId('hint-box')).toBeNull();
    const reopen = screen.getByTestId('hint-reopen');
    expect(reopen.textContent).toContain('Hint');
    expect(screen.getByTestId('hint-new').textContent).toBe('· 2 new');
    fireEvent.click(reopen);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('closed without new rules: no `new` marker', () => {
    box({ open: false, newCount: 0 });
    expect(screen.queryByTestId('hint-new')).toBeNull();
  });

  it('pending playback: the hints wait for the finish', () => {
    box({ pending: true });
    expect(screen.getByTestId('hint-pending')).toBeTruthy();
    expect(screen.queryByTestId('hint-open')).toBeNull();
  });
});
