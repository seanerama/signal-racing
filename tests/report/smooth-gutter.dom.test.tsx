/** Stage 9: the Smooth toggle in the gutter menu and the `~` marker. */
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripGutter } from '@/report/StripGutter';

afterEach(() => cleanup());

const noop = () => undefined;
const base = {
  id: 'speed_diff_rl',
  label: 'Wheel slip speed rear left',
  unit: 'km/h',
  slot: 0,
  onRemove: noop,
  onDragStart: noop,
  onDragEnd: noop,
  onKeyDown: noop,
  onFocus: noop,
};

describe('Smooth (5-pt centred mean)', () => {
  it('is a checkbox menu item; selecting it calls the toggle', () => {
    const onSelect = vi.fn();
    render(
      <StripGutter
        {...base}
        menu={[{ label: 'Smooth (5-pt centred mean)', checked: false, onSelect }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'speed_diff_rl strip menu' }));
    const item = screen.getByRole('menuitemcheckbox', { name: 'Smooth (5-pt centred mean)' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('a smoothed strip shows ~ after the id; a raw one does not', () => {
    const { container, rerender } = render(<StripGutter {...base} smoothed />);
    expect(container.querySelector('.strip__smooth')?.textContent).toBe('~');
    rerender(<StripGutter {...base} />);
    expect(container.querySelector('.strip__smooth')).toBeNull();
  });
});
