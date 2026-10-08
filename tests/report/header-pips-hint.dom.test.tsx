import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeverId, Setup } from '@/engine/types';
import { lastAnnouncement, runAnnouncement } from '@/report/a11y';
import { DeltaValue, deltaParts } from '@/report/DeltaValue';
import { HintPopover } from '@/report/HintPopover';
import { ResultHeader } from '@/report/ResultHeader';
import { pipKinds, RunPips } from '@/report/RunPips';
import { FIXTURE_HINTS, FIXTURE_LEVERS, FIXTURE_LOCKED } from '@/report/__fixtures__';
import type { ResultHeaderProps } from '@/report/types';

afterEach(cleanup);

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
    ...over,
  };
  return render(<ResultHeader {...props} />);
}

describe('DeltaValue', () => {
  it('faster is ▼ − in gain; slower is ▲ + in loss; zero is neutral', () => {
    expect(deltaParts(-0.142)).toEqual({ glyph: '▼', text: '−0.142', tone: 'gain' });
    expect(deltaParts(0.087)).toEqual({ glyph: '▲', text: '+0.087', tone: 'loss' });
    expect(deltaParts(0.0001).tone).toBe('even');
    render(<DeltaValue value={-0.211} label="best" />);
    const el = document.querySelector('.delta') as HTMLElement;
    expect(el.classList.contains('delta--gain')).toBe(true);
    expect(el.textContent).toContain('▼');
    expect(el.textContent).toContain('−0.211');
    expect(el.getAttribute('aria-label')).toBe('0.211 faster than best');
  });
});

describe('ResultHeader', () => {
  it('shows the time, Δbest faster and Δtarget slower with glyphs and tones', () => {
    header();
    expect(screen.getByTestId('rh-time').textContent).toContain('14.732');
    const deltas = [...document.querySelectorAll<HTMLElement>('.delta')];
    expect(deltas[0]!.dataset['tone']).toBe('gain');
    expect(deltas[0]!.textContent).toContain('▼−0.211');
    expect(deltas[1]!.dataset['tone']).toBe('loss');
    expect(deltas[1]!.textContent).toContain('▲+0.084');
    expect(screen.queryByTestId('chip-pb')).toBeNull();
    expect(screen.queryByTestId('chip-target')).toBeNull();
  });

  it('PB: time in --best with a PB chip; pass: TARGET chip and debrief CTA', () => {
    const onDebrief = vi.fn();
    header({ isPB: true, passed: true, onDebrief });
    expect(screen.getByTestId('chip-pb').textContent).toBe('PB');
    expect(screen.getByTestId('rh-time').classList.contains('rh__time--pb')).toBe(true);
    expect(screen.getByTestId('chip-target').textContent).toBe('TARGET');
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
    expect(wd.textContent).toContain('0.45');
    expect(wing.textContent).toContain('4');
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

  it('renders an empty state without a run', () => {
    header({ run: null });
    expect(screen.getByTestId('result-header').textContent).toContain('No run yet');
  });
});

describe('RunPips', () => {
  it('remaining filled, runs hollow, hints struck; label counts', () => {
    expect(pipKinds({ budget: 6, usedByRuns: 3, usedByHints: 1 })).toEqual([
      'left',
      'left',
      'run',
      'run',
      'run',
      'hint',
    ]);
    render(<RunPips budget={6} usedByRuns={3} usedByHints={1} />);
    const pips = screen.getByTestId('run-pips');
    expect(pips.getAttribute('aria-label')).toBe('2 of 6 runs left, 1 spent on hints');
    expect(pips.querySelectorAll('.pip--hint')).toHaveLength(1);
    expect(pips.textContent).toContain('2/6 runs');
  });

  it('never overflows the budget', () => {
    expect(pipKinds({ budget: 3, usedByRuns: 5, usedByHints: 1 })).toEqual(['run', 'run', 'hint']);
  });
});

describe('HintPopover', () => {
  function popover(over: Partial<Parameters<typeof HintPopover>[0]> = {}) {
    const onOpenNext = vi.fn();
    const onChannelClick = vi.fn();
    render(
      <HintPopover
        tiersOpened={1}
        cost={[1, 1, 1]}
        runsLeft={3}
        texts={FIXTURE_HINTS.slice(0, 1)}
        onOpenNext={onOpenNext}
        onChannelClick={onChannelClick}
        {...over}
      />,
    );
    return { onOpenNext, onChannelClick };
  }

  it('first click arms (confirm inside the button), second commits', () => {
    const { onOpenNext } = popover();
    const btn = screen.getByTestId('hint-open');
    expect(btn.textContent).toContain('Open explain');
    fireEvent.click(btn);
    expect(onOpenNext).not.toHaveBeenCalled();
    expect(btn.textContent).toContain('OPEN −1 RUN?');
    fireEvent.click(btn);
    expect(onOpenNext).toHaveBeenCalledTimes(1);
  });

  it('Esc and blur disarm', () => {
    const { onOpenNext } = popover();
    const btn = screen.getByTestId('hint-open');
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(btn.textContent).not.toContain('?');
    fireEvent.click(btn);
    fireEvent.blur(btn);
    fireEvent.click(btn);
    expect(onOpenNext).not.toHaveBeenCalled();
  });

  it('the tier number key arms then commits', () => {
    const { onOpenNext } = popover();
    const panel = screen.getByTestId('hint-popover');
    fireEvent.keyDown(panel, { key: '2' });
    fireEvent.keyDown(panel, { key: '2' });
    expect(onOpenNext).toHaveBeenCalledTimes(1);
  });

  it('is disabled when runsLeft < cost', () => {
    const { onOpenNext } = popover({ cost: [1, 2, 2], runsLeft: 1 });
    const btn = screen.getByTestId('hint-open');
    expect(btn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onOpenNext).not.toHaveBeenCalled();
    expect(screen.getByText(/Needs 2 runs; 1 left/)).toBeTruthy();
  });

  it('channel ids are clickable links; tier labels show', () => {
    const { onChannelClick } = popover();
    expect(screen.getByText('Observe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'rear_slip_ratio' }));
    expect(onChannelClick).toHaveBeenCalledWith('rear_slip_ratio');
  });

  it('no open button once all three tiers are open', () => {
    popover({ tiersOpened: 3 });
    expect(screen.queryByTestId('hint-open')).toBeNull();
  });
});
