import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/app/components/Button';
import { SegmentedControl } from '@/app/components/SegmentedControl';

afterEach(cleanup);

const OPTIONS = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
] as const;

describe('SegmentedControl', () => {
  it('renders a radiogroup with the selected option checked', () => {
    render(<SegmentedControl label="Units" options={OPTIONS} value="metric" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Units' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Metric' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Imperial' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('calls onChange on click and on arrow keys', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Units" options={OPTIONS} value="metric" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Imperial' }));
    expect(onChange).toHaveBeenLastCalledWith('imperial');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('imperial');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('imperial'); // wraps from index 0
  });

  it('does not fire for the already-selected option or when disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl label="Units" options={OPTIONS} value="metric" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Metric' }));
    rerender(
      <SegmentedControl
        label="Units"
        options={OPTIONS}
        value="metric"
        onChange={onChange}
        disabled
      />,
    );
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Button', () => {
  it('renders variants as classes and fires onClick', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" size="run" onClick={onClick}>
        Run
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Run' });
    expect(btn.className).toContain('btn--primary');
    expect(btn.className).toContain('btn--run');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('busy: shows the busy label, a progressbar, and is disabled', () => {
    render(
      <Button variant="primary" busy busyLabel="Computing target 64%" progress={0.64}>
        Run
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('Computing target 64%');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('64');
  });

  it('hint tier: shows the cost badge and pressed state', () => {
    render(
      <Button variant="hint" cost={1} pressed>
        Hint 1
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('−1');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});
