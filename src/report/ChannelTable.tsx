/**
 * Channel table (contract 07, design-system "Channel table"): every channel in the level with
 * this-run and best-run min/max/mean. A real `<table>` (the stack's accessible twin), virtualised
 * by hand: only the rows in view (plus overscan) are in the DOM, padded by spacer rows.
 *
 * Sort by any column (default: alphabetical by id; roles are never shown or used). Filter by
 * substring of id or label; `/` focuses the filter. Click a row (or its checkbox) to toggle the
 * strip; drag a row into the stack to insert it at a position.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ChannelId, Quantity } from '@/engine/types';
import type { ChannelStats } from '@/telemetry/types';
import { formatValue, precision, toDisplay, unitLabel, type UnitSystem } from '@/units';
import { channelMeta } from './channel-meta';
import { beginDrag, endDrag } from './dnd';
import { useProjectorMode } from './projector';
import type { ChannelTableProps } from './types';
import { slotToken } from './uplot-theme';
import './ChannelTable.css';

export const ROW_H = 22;
const OVERSCAN = 6;
const FALLBACK_VIEWPORT = 560;

type StatKey = 'min' | 'max' | 'mean';
export type SortKey = 'id' | 'unit' | `cur.${StatKey}` | `best.${StatKey}` | 'dmean' | 'dropouts';
export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

interface Row {
  id: ChannelId;
  label: string;
  quantity: Quantity;
  unit: string;
  cur: ChannelStats | undefined;
  best: ChannelStats | undefined;
}

function statValue(row: Row, key: SortKey): number | string {
  switch (key) {
    case 'id':
      return row.id;
    case 'unit':
      return row.unit;
    case 'dmean':
      return (row.cur?.mean ?? NaN) - (row.best?.mean ?? NaN);
    case 'dropouts':
      return row.cur?.dropouts ?? NaN;
    default: {
      const [which, stat] = key.split('.') as ['cur' | 'best', StatKey];
      return row[which]?.[stat] ?? NaN;
    }
  }
}

/** Sorts rows; NaN/missing always last; ties break alphabetically by id. */
export function sortRows<T extends Row>(rows: T[], sort: SortState): T[] {
  return rows.slice().sort((a, b) => {
    const va = statValue(a, sort.key);
    const vb = statValue(b, sort.key);
    let c = 0;
    if (typeof va === 'string' || typeof vb === 'string') {
      c = String(va).localeCompare(String(vb)) * sort.dir;
    } else {
      const na = !Number.isFinite(va);
      const nb = !Number.isFinite(vb);
      if (na !== nb) return na ? 1 : -1;
      c = na ? 0 : (va - vb) * sort.dir;
    }
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
}

/** Substring match on id and label, case-insensitive. */
export function filterRows<T extends { id: string; label: string }>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (r) => r.id.toLowerCase().includes(needle) || r.label.toLowerCase().includes(needle),
  );
}

function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(query).matches : false;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const mq = globalThis.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return m;
}

function Cell({ q, units, v }: { q: Quantity; units: UnitSystem; v: number | undefined }) {
  if (v === undefined || !Number.isFinite(v)) return <td class="ct__num faint">—</td>;
  const full = `${toDisplay(q, units, v)}${unitLabel(q, units) ? ` ${unitLabel(q, units)}` : ''}`;
  return (
    <td class="ct__num" title={full}>
      {formatValue(q, units, v, { withUnit: false })}
    </td>
  );
}

export function ChannelTable({
  ids,
  current,
  best,
  inStack,
  onToggle,
  units,
  header,
}: ChannelTableProps) {
  const projector = useProjectorMode();
  const wide = useMediaQuery('(min-width: 1680px)');
  const showBest = !projector;
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'id', dir: 1 });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // `/` focuses the filter (unless typing in another field).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== '/' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      ev.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight > 0 ? el.clientHeight : FALLBACK_VIEWPORT);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      ids.map((id) => {
        const meta = channelMeta(id);
        return {
          id,
          label: meta.label,
          quantity: meta.quantity,
          unit: unitLabel(meta.quantity, units),
          cur: current?.stats[id],
          best: best?.stats[id],
        };
      }),
    [ids, current, best, units],
  );
  const visibleRows = useMemo(() => sortRows(filterRows(rows, filter), sort), [rows, filter, sort]);

  // Slot index per channel in the stack (Set iteration order = strip order).
  const slots = useMemo(() => {
    const m = new Map<ChannelId, number>();
    let i = 0;
    for (const id of inStack) m.set(id, i++);
    return m;
  }, [inStack]);

  const total = visibleRows.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const count = Math.ceil(viewport / ROW_H) + OVERSCAN * 2;
  const last = Math.min(total, first + count);
  const windowRows = visibleRows.slice(first, last);

  const setSortKey = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const th = (key: SortKey, text: string, cls = 'ct__num') => {
    const active = sort.key === key;
    return (
      <th
        class={`${cls}${active ? ' ct__th--active' : ''}`}
        aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
        scope="col"
      >
        <button type="button" class="ct__sort" onClick={() => setSortKey(key)}>
          {text}
          {active ? (sort.dir === 1 ? ' ▴' : ' ▾') : ''}
        </button>
      </th>
    );
  };

  const colCount = 3 + 3 + (showBest ? 3 : 0) + (wide ? 2 : 0);

  return (
    <section class="ct" aria-label="Channels" data-testid="channel-table">
      <div class="ct__bar">
        <h2 class="h2 dim ct__title">
          Channels <span class="micro faint">{ids.length}</span>
        </h2>
        <input
          ref={filterRef}
          class="ct__filter data"
          type="search"
          placeholder="filter…  /"
          aria-label="Filter channels"
          value={filter}
          onInput={(ev: JSX.TargetedEvent<HTMLInputElement>) => {
            setFilter(ev.currentTarget.value);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
            setScrollTop(0);
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape' && filter) {
              ev.stopPropagation();
              setFilter('');
            }
          }}
        />
      </div>
      {header && <div class="ct__slot">{header}</div>}
      <div
        class="ct__scroll"
        ref={scrollRef}
        onScroll={(ev) => setScrollTop(ev.currentTarget.scrollTop)}
      >
        <table class={`ct__table data${showBest ? '' : ' ct__table--nobest'}`}>
          <thead>
            <tr class="ct__group">
              <th class="ct__stick ct__stick--0" />
              <th class="ct__stick ct__stick--1" />
              <th />
              <th colSpan={3} class="ct__grp micro">
                THIS RUN
              </th>
              {showBest && (
                <th colSpan={3} class="ct__grp ct__grp--best micro">
                  BEST
                </th>
              )}
              {wide && <th colSpan={2} class="ct__grp micro" />}
            </tr>
            <tr>
              <th class="ct__stick ct__stick--0 ct__chk" scope="col">
                <span class="visually-hidden">In stack</span>
              </th>
              {th('id', 'channel', 'ct__stick ct__stick--1 ct__id')}
              {th('unit', 'unit', 'ct__unit')}
              {th('cur.min', 'min')}
              {th('cur.max', 'max')}
              {th('cur.mean', 'mean')}
              {showBest && th('best.min', 'min', 'ct__num ct__best-first')}
              {showBest && th('best.max', 'max')}
              {showBest && th('best.mean', 'mean')}
              {wide && th('dmean', 'Δmean')}
              {wide && th('dropouts', 'drops')}
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <tr class="ct__spacer" aria-hidden="true" style={{ height: `${first * ROW_H}px` }}>
                <td colSpan={colCount} />
              </tr>
            )}
            {windowRows.map((r) => {
              const on = inStack.has(r.id);
              const slot = slots.get(r.id);
              const dmean = (r.cur?.mean ?? NaN) - (r.best?.mean ?? NaN);
              const drops = r.cur?.dropouts;
              return (
                <tr
                  key={r.id}
                  class={`ct__row${on ? ' ct__row--on' : ''}`}
                  data-channel={r.id}
                  draggable
                  onDragStart={(ev) => beginDrag(ev, { id: r.id, from: 'table' })}
                  onDragEnd={() => endDrag()}
                  onClick={() => onToggle(r.id)}
                  title={r.label}
                >
                  <td class="ct__stick ct__stick--0 ct__chk">
                    <span
                      class="ct__swatch"
                      style={
                        on && slot !== undefined
                          ? { background: `var(${slotToken(slot)})` }
                          : undefined
                      }
                      aria-hidden="true"
                    />
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={`${r.id} in stack`}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={() => onToggle(r.id)}
                    />
                  </td>
                  <th scope="row" class="ct__stick ct__stick--1 ct__id">
                    {r.id}
                  </th>
                  <td class="ct__unit dim">{r.unit || '—'}</td>
                  <Cell q={r.quantity} units={units} v={r.cur?.min} />
                  <Cell q={r.quantity} units={units} v={r.cur?.max} />
                  <Cell q={r.quantity} units={units} v={r.cur?.mean} />
                  {showBest && <Cell q={r.quantity} units={units} v={r.best?.min} />}
                  {showBest && <Cell q={r.quantity} units={units} v={r.best?.max} />}
                  {showBest && <Cell q={r.quantity} units={units} v={r.best?.mean} />}
                  {wide && (
                    <td class="ct__num">
                      {Number.isFinite(dmean)
                        ? `${dmean > 0 ? '+' : dmean < 0 ? '−' : ''}${Math.abs(
                            toDisplay(r.quantity, units, dmean) - toDisplay(r.quantity, units, 0),
                          ).toFixed(precision(r.quantity, units))}`
                        : '—'}
                    </td>
                  )}
                  {wide && <td class="ct__num">{drops ?? '—'}</td>}
                </tr>
              );
            })}
            {last < total && (
              <tr
                class="ct__spacer"
                aria-hidden="true"
                style={{ height: `${(total - last) * ROW_H}px` }}
              >
                <td colSpan={colCount} />
              </tr>
            )}
          </tbody>
        </table>
        {total === 0 && <div class="ct__none data faint">No channel matches “{filter}”.</div>}
      </div>
    </section>
  );
}
