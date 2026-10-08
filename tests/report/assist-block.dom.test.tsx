/**
 * AssistBlock (Stage 8): off by default shows no ranking; on with too few runs shows
 * "Needs 3 runs"; on with rows shows five `rank · channel · r · reason` rows with add-to-stack.
 * CsvButton names the file `signal_<level>_run<n>.csv`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistRow } from '@/assist/rank';
import { AssistBlock } from '@/report/AssistBlock';
import { csvFileName } from '@/report/CsvButton';

afterEach(cleanup);

const rows: AssistRow[] = [
  'segment_delta',
  'drag_force',
  'throttle',
  'long_g',
  'rear_slip_ratio',
].map((channel, i) => ({
  channel,
  r: i % 2 ? -0.8 : 0.9,
  score: 1 - i / 10,
  reason:
    i === 0 ? '`x` ended the straight 0.2 s over its floor' : 'moves with lap time (r = +0.90)',
  fromRule: i === 0 ? 'segment_paying' : null,
}));

const base = {
  rows,
  counts: { session: 2, recorded: 8, past: 0 },
  minRuns: 3,
  inStack: new Set(['throttle']),
  onToggle: () => undefined,
  onAdd: () => undefined,
  onChannelClick: () => undefined,
};

describe('AssistBlock', () => {
  it('off: a toggle and no ranking', () => {
    const onToggle = vi.fn();
    render(<AssistBlock {...base} on={false} onToggle={onToggle} />);
    expect(screen.queryByTestId('assist-rows')).toBeNull();
    fireEvent.click(screen.getByTestId('assist-toggle'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('on, too few runs: "Needs 3 runs"', () => {
    render(<AssistBlock {...base} on rows={[]} counts={{ session: 2, recorded: 0, past: 0 }} />);
    expect(screen.getByTestId('assist-needs').textContent).toBe('Needs 3 runs (2 so far).');
  });

  it('on: five rows with signed r, reasons, add-to-stack and the run count', () => {
    const onAdd = vi.fn();
    const onChannelClick = vi.fn();
    render(<AssistBlock {...base} on onAdd={onAdd} onChannelClick={onChannelClick} />);
    const items = screen.getByTestId('assist-rows').querySelectorAll('li');
    expect(items).toHaveLength(5);
    expect(items[0]!.textContent).toContain('segment_delta');
    expect(items[0]!.textContent).toContain('r +0.90');
    expect(items[1]!.textContent).toContain('r −0.80');
    expect(items[0]!.textContent).toContain('rule segment_paying');
    // throttle is already in the stack.
    expect(screen.getByRole('button', { name: 'throttle is in the stack' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add drag_force to stack' }));
    expect(onAdd).toHaveBeenCalledWith('drag_force');
    fireEvent.click(screen.getByRole('button', { name: 'long_g' }));
    expect(onChannelClick).toHaveBeenCalledWith('long_g');
    expect(screen.getByTestId('assist-foot').textContent).toBe(
      '10 runs: 2 this session · 8 recorded (demo profile). Correlation is not cause.',
    );
  });
});

describe('CsvButton', () => {
  it('names the file signal_<level>_run<n>.csv', () => {
    expect(csvFileName('B4L', 3)).toBe('signal_B4L_run3.csv');
  });
});
