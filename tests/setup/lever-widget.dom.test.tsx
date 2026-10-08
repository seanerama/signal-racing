import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeverSpec } from '@/levels/types';
import { indexOf, parseTyped, snap, stepBy, stepCount, valueAt } from '@/setup/lever-math';
import { LeverWidget } from '@/setup/LeverWidget';

afterEach(cleanup);

const RAMP: LeverSpec = {
  id: 'throttle_ramp',
  label: 'Throttle ramp',
  quantity: 'time',
  min: 0,
  max: 3,
  step: 0.2,
  default: 0.4,
};
const PRESSURE: LeverSpec = {
  id: 'tire_pressure',
  label: 'Tire pressure',
  quantity: 'pressure',
  min: 1.2,
  max: 2.2,
  step: 0.1,
  default: 1.7,
};

describe('lever math', () => {
  it('steps on an exact integer grid and clamps at the ends', () => {
    expect(stepCount(RAMP)).toBe(15);
    expect(valueAt(RAMP, 3)).toBe(0.6);
    expect(stepBy(RAMP, 0.4, 1)).toBe(0.6);
    expect(stepBy(RAMP, 0, -1)).toBe(0);
    expect(stepBy(RAMP, 3, 1)).toBe(3);
    expect(snap(PRESSURE, 1.66)).toBe(1.7);
    expect(indexOf(PRESSURE, 2.2)).toBe(10);
  });

  it('parses typed values in display units, rejecting off-grid and out-of-range input', () => {
    expect(parseTyped(RAMP, '0.6', 'metric')).toBe(0.6);
    expect(parseTyped(RAMP, '0.60 s', 'metric')).toBe(0.6);
    expect(parseTyped(RAMP, '0.5', 'metric')).toBeNull(); // between steps
    expect(parseTyped(RAMP, '4', 'metric')).toBeNull(); // out of range
    expect(parseTyped(RAMP, 'abc', 'metric')).toBeNull();
    expect(parseTyped(PRESSURE, '24.7', 'imperial')).toBe(1.7); // psi → bar, snapped
  });
});

describe('LeverWidget', () => {
  it('◀/▶ and arrow keys step one grid point', () => {
    const onChange = vi.fn();
    render(<LeverWidget spec={RAMP} value={0.4} units="metric" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Increase Throttle ramp'));
    expect(onChange).toHaveBeenLastCalledWith(0.6);
    fireEvent.click(screen.getByLabelText('Decrease Throttle ramp'));
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(0.6);
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(0); // 5 steps, clamped
    expect(slider.getAttribute('aria-valuenow')).toBe('0.4');
  });

  it('renders a tick for every step', () => {
    const { container } = render(<LeverWidget spec={RAMP} value={0.4} units="metric" />);
    expect(container.querySelectorAll('.lever__tick')).toHaveLength(16);
  });

  it('click-to-type: Enter commits a valid value, an invalid one reverts without a change', () => {
    const onChange = vi.fn();
    render(<LeverWidget spec={RAMP} value={0.4} units="metric" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('lever-value-throttle_ramp'));
    const input = screen.getByTestId<HTMLInputElement>('lever-input-throttle_ramp');
    expect(input.value).toBe('0.400');
    fireEvent.input(input, { target: { value: '1.2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(1.2);

    onChange.mockClear();
    fireEvent.click(screen.getByTestId('lever-value-throttle_ramp'));
    const again = screen.getByTestId('lever-input-throttle_ramp');
    fireEvent.input(again, { target: { value: '0.5' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    const shown = screen.getByTestId('lever-value-throttle_ramp');
    expect(shown.textContent).toBe('0.400 s');
    expect(shown.className).toContain('lever__value--shake');
  });

  it('Esc reverts an edit', () => {
    const onChange = vi.fn();
    render(<LeverWidget spec={RAMP} value={0.4} units="metric" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('lever-value-throttle_ramp'));
    const input = screen.getByTestId('lever-input-throttle_ramp');
    fireEvent.input(input, { target: { value: '2.0' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('lever-input-throttle_ramp')).toBeNull();
  });

  it('shows the ghost ◇ at the last run and the accent dot when changed', () => {
    const { rerender } = render(<LeverWidget spec={RAMP} value={0.4} units="metric" />);
    expect(screen.queryByTestId('lever-ghost-throttle_ramp')).toBeNull();
    expect(screen.queryByLabelText('changed')).toBeNull();

    rerender(<LeverWidget spec={RAMP} value={0.4} lastValue={0.4} units="metric" />);
    expect(screen.getByTestId('lever-ghost-throttle_ramp').style.left).toBe(`${(2 / 15) * 100}%`);
    expect(screen.queryByLabelText('changed')).toBeNull();

    rerender(<LeverWidget spec={RAMP} value={1.0} lastValue={0.4} units="metric" />);
    expect(screen.getByLabelText('changed')).toBeTruthy();
  });

  it('locked: faint, lock glyph, the value, no slider or steppers', () => {
    const { container } = render(
      <LeverWidget spec={PRESSURE} value={1.65} units="imperial" locked />,
    );
    expect(container.querySelector('.lever--locked')?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByLabelText('locked')).toBeTruthy();
    expect(screen.getByTestId('lever-value-tire_pressure').textContent).toBe('23.9 psi');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByLabelText(/Increase/)).toBeNull();
  });
});
