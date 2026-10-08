/**
 * Stage 7 hook on the strip gutter: the optional `gutterMenu` prop (e.g. "Waterfall…").
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelId } from '@/engine/types';
import { FakeUPlot } from './fake-uplot';

vi.mock('uplot', async () => ({ default: (await import('./fake-uplot')).FakeUPlot }));

const { StripStack } = await import('@/report/StripStack');
const { installFixtureChannelMeta, makeReportFixture } = await import('@/report/__fixtures__');

const STRIPS: ChannelId[] = ['speed', 'long_g', 'clutch_temp'];

beforeAll(() => installFixtureChannelMeta());
beforeEach(() => FakeUPlot.reset());
afterEach(() => cleanup());

function renderStack(gutterMenu?: (id: ChannelId) => Array<{ label: string; onSelect(): void }>) {
  const fx = makeReportFixture(40);
  const onStripsChange = vi.fn();
  render(
    <StripStack
      current={fx.current}
      best={fx.best}
      strips={STRIPS}
      onStripsChange={onStripsChange}
      availableIds={new Set(fx.ids.filter((id) => id !== 'clutch_temp'))}
      axis="time"
      units="metric"
      {...(gutterMenu ? { gutterMenu } : {})}
    />,
  );
  return { onStripsChange };
}

describe('strip gutter menu', () => {
  it('renders no menu button without gutterMenu (existing behaviour)', () => {
    renderStack();
    expect(document.querySelectorAll('.strip__menu-btn')).toHaveLength(0);
  });

  it('opens on click, and an item calls onSelect with the strip id', () => {
    const picked: ChannelId[] = [];
    renderStack((id) => [{ label: 'Waterfall…', onSelect: () => picked.push(id) }]);
    // Real strips get a button; the placeholder row does not.
    expect(document.querySelectorAll('.strip__menu-btn')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'long_g strip menu' }));
    const item = screen.getByRole('menuitem', { name: 'Waterfall…' });
    fireEvent.click(item);
    expect(picked).toEqual(['long_g']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keys inside the menu do not reach the gutter (no remove on Delete); Esc closes', () => {
    const { onStripsChange } = renderStack(() => [{ label: 'Waterfall…', onSelect: () => {} }]);
    fireEvent.click(screen.getByRole('button', { name: 'speed strip menu' }));
    const item = screen.getByRole('menuitem', { name: 'Waterfall…' });
    fireEvent.keyDown(item, { key: 'Delete' });
    expect(onStripsChange).not.toHaveBeenCalled();
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Shift+F10 on a focused gutter opens its menu', () => {
    renderStack(() => [{ label: 'Waterfall…', onSelect: () => {} }]);
    const gutter = document.querySelector<HTMLElement>('[data-strip-gutter="speed"]')!;
    fireEvent.keyDown(gutter, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: 'Waterfall…' })).toBeTruthy();
  });
});
