import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelTable, filterRows, sortRows } from '@/report/ChannelTable';
import { installFixtureChannelMeta, makeReportFixture } from '@/report/__fixtures__';

beforeAll(() => installFixtureChannelMeta());
afterEach(cleanup);

function renderTable(size: 12 | 40 | 200 = 12, inStack = new Set<string>(['speed', 'lat_g'])) {
  const fx = makeReportFixture(size);
  const onToggle = vi.fn();
  render(
    <ChannelTable
      ids={fx.ids}
      current={fx.currentSummary}
      best={fx.bestSummary}
      inStack={inStack}
      onToggle={onToggle}
      units="metric"
    />,
  );
  return { fx, onToggle };
}

/** Channel ids of the rendered body rows, in order. */
function bodyIds(): string[] {
  return [...document.querySelectorAll<HTMLTableRowElement>('tbody tr[data-channel]')].map(
    (r) => r.dataset['channel'] ?? '',
  );
}

describe('ChannelTable', () => {
  it('defaults to alphabetical by id (roles never drive order)', () => {
    renderTable(12);
    const ids = bodyIds();
    expect(ids).toEqual([...ids].sort());
  });

  it('sorts by a column, toggling direction on a second click', () => {
    const { fx } = renderTable(12);
    const thead = document.querySelector('thead') as HTMLElement;
    const maxButtons = within(thead).getAllByRole('button', { name: /^max/ });
    fireEvent.click(maxButtons[0]!); // this run · max, ascending
    const asc = bodyIds().map((id) => fx.currentSummary.stats[id]!.max);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    fireEvent.click(within(thead).getAllByRole('button', { name: /^max/ })[0]!);
    const desc = bodyIds().map((id) => fx.currentSummary.stats[id]!.max);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(thead.querySelector('[aria-sort="descending"]')).toBeTruthy();
  });

  it('filters by substring of id or label', () => {
    renderTable(40);
    const input = screen.getByRole('searchbox', { name: 'Filter channels' });
    fireEvent.input(input, { target: { value: 'tire_temp' } });
    expect(bodyIds().length).toBeGreaterThan(0);
    expect(bodyIds().every((id) => id.includes('tire_temp'))).toBe(true);
    // Label match: "Ground speed" is the label of `speed`.
    fireEvent.input(input, { target: { value: 'ground' } });
    expect(bodyIds()).toEqual(['speed']);
  });

  it('"/" focuses the filter', () => {
    renderTable(12);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Filter channels' }));
  });

  it('toggles a strip by row click or checkbox', () => {
    const { onToggle } = renderTable(12);
    const row = document.querySelector('tr[data-channel="oil_temp"]') as HTMLElement;
    fireEvent.click(row);
    expect(onToggle).toHaveBeenLastCalledWith('oil_temp');
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'speed in stack' });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenLastCalledWith('speed');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('virtualises: 200 channels render at most 40 DOM rows', () => {
    renderTable(200);
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBeLessThanOrEqual(40);
    expect(rows.length).toBeGreaterThan(10);
    // The spacer keeps the full scroll height.
    const spacer = document.querySelector<HTMLElement>('tbody tr.ct__spacer');
    expect(parseFloat(spacer?.style.height ?? '0')).toBeGreaterThan(100 * 22);
  });

  it('scrolling moves the window', () => {
    renderTable(200);
    const first = bodyIds()[0];
    const scroller = document.querySelector('.ct__scroll') as HTMLElement;
    scroller.scrollTop = 100 * 22;
    fireEvent.scroll(scroller);
    expect(bodyIds()[0]).not.toBe(first);
    expect(document.querySelectorAll('tbody tr').length).toBeLessThanOrEqual(40);
  });

  it('filter keystrokes stay under 16 ms each with 200 rows', () => {
    renderTable(200);
    const input = screen.getByRole('searchbox', { name: 'Filter channels' });
    const word = 'temp_rl';
    const times: number[] = [];
    // Warm up once (JIT), then measure each keystroke including the re-render.
    void act(() => {
      fireEvent.input(input, { target: { value: 'x' } });
    });
    void act(() => {
      fireEvent.input(input, { target: { value: '' } });
    });
    for (let i = 1; i <= word.length; i++) {
      const t0 = performance.now();
      void act(() => {
        fireEvent.input(input, { target: { value: word.slice(0, i) } });
      });
      times.push(performance.now() - t0);
    }
    const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]!;
    expect(median).toBeLessThan(16);
  });

  it('renders the header slot', () => {
    const fx = makeReportFixture(12);
    render(
      <ChannelTable
        ids={fx.ids}
        current={null}
        best={null}
        inStack={new Set()}
        onToggle={() => {}}
        units="metric"
        header={<div data-testid="assist">ASSIST</div>}
      />,
    );
    expect(screen.getByTestId('assist')).toBeTruthy();
  });

  it('shows units per the unit system and dashes for missing stats', () => {
    const fx = makeReportFixture(12);
    render(
      <ChannelTable
        ids={fx.ids}
        current={fx.currentSummary}
        best={null}
        inStack={new Set()}
        onToggle={() => {}}
        units="imperial"
      />,
    );
    const row = document.querySelector('tr[data-channel="speed"]') as HTMLElement;
    expect(row.textContent).toContain('mph');
    expect(row.textContent).toContain('—');
  });
});

describe('ChannelTable helpers', () => {
  const rows = [
    {
      id: 'b',
      label: 'Bee',
      quantity: 'ratio' as const,
      unit: '',
      cur: undefined,
      best: undefined,
    },
    {
      id: 'a',
      label: 'Ant',
      quantity: 'ratio' as const,
      unit: '',
      cur: { min: 1, max: 5, mean: 2, argmin: 0, argmax: 0, tMin: 0, tMax: 0, dropouts: 0 },
      best: undefined,
    },
  ];
  it('sortRows puts missing values last in both directions', () => {
    expect(sortRows(rows, { key: 'cur.max', dir: 1 }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(sortRows(rows, { key: 'cur.max', dir: -1 }).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('filterRows matches id or label, case-insensitively', () => {
    expect(filterRows(rows, 'BEE').map((r) => r.id)).toEqual(['b']);
    expect(filterRows(rows, '  ').length).toBe(2);
  });
});
