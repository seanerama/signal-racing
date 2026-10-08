/**
 * The strip stack (contract 07, design-system "Strip" + "Cursor"): synced uPlot strips with the
 * best run underneath, a shared pinnable cursor, Shift+drag zoom across strips, drag reorder,
 * keyboard reorder/remove, and placeholders for channels not on this level.
 *
 * Only strips in the stack instantiate uPlot (lazily, when visible); placeholders never do.
 */
import { effect } from '@preact/signals';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type uPlot from 'uplot';
import type { ChannelId } from '@/engine/types';
import { channelMeta } from './channel-meta';
import { handleCursorKey, pushCursor } from './cursor';
import { cursorIdx, cursorPinned, replaying } from './cursor-store';
import { beginDrag, endDrag, readDrag } from './dnd';
import { useProjectorMode } from './projector';
import { selectedStrip } from './selection';
import { Strip } from './Strip';
import { axisValue, timeToAxis } from './strip-data';
import { StripPlaceholder } from './StripPlaceholder';
import { insertStrip, moveBy, removeStrip } from './strip-ops';
import type { StripStackProps } from './types';
import { cssPx } from './uplot-theme';
import { applyZoom, xZoom, zoomFor, zoomFrame as frameOf } from './zoom';
import './StripStack.css';

let syncSeq = 0;

const MIN_H = 48;
const MAX_H = 160;

interface DropTarget {
  /** Insert before the strip at this index (`strips.length` = append). */
  index: number;
}

export function StripStack({
  current,
  best,
  history,
  strips,
  onStripsChange,
  availableIds,
  axis,
  segmentBoundaries,
  segmentLabels,
  hintWindow = null,
  units,
  flashChannel = null,
  gutterMenu,
  smoothed,
}: StripStackProps) {
  const projector = useProjectorMode();
  const syncKey = useMemo(() => `signal-strips-${++syncSeq}`, []);
  const frame = frameOf(axis, units);
  const plots = useRef(new Map<ChannelId, { u: uPlot; xs: ArrayLike<number> }>());
  const gutters = useRef(new Map<ChannelId, HTMLDivElement>());
  const [heights, setHeights] = useState<Record<ChannelId, number>>({});
  const [dragId, setDragId] = useState<ChannelId | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [flashing, setFlashing] = useState<ChannelId | null>(null);
  const focusAfter = useRef<ChannelId | null>(null);
  const initialIds = useRef<Set<ChannelId> | null>(null);
  if (initialIds.current === null) initialIds.current = new Set(strips);

  const defaultH = useMemo(() => cssPx('--strip-h', projector ? 96 : 72), [projector]);
  const stripsRef = useRef(strips);
  stripsRef.current = strips;
  const change = useCallback((next: ChannelId[]) => onStripsChange(next), [onStripsChange]);

  // Index of the bottom-most real strip (the one that shows the x-axis).
  const bottomId = useMemo(() => {
    for (let i = strips.length - 1; i >= 0; i--) {
      const id = strips[i] as ChannelId;
      if (availableIds.has(id)) return id;
    }
    return null;
  }, [strips, availableIds]);

  const registerPlot = useCallback(
    (id: ChannelId, u: uPlot | null, xs: ArrayLike<number> | null) => {
      if (u && xs) {
        plots.current.set(id, { u, xs });
        // A freshly built strip picks up a cursor set elsewhere (pinned, replay).
        pushCursor([u], cursorIdx.value, xs);
      } else plots.current.delete(id);
    },
    [],
  );

  // Push the shared cursor into every plot when it changes from anywhere (replay, keys, track).
  useEffect(
    () =>
      effect(() => {
        const idx = cursorIdx.value;
        for (const { u, xs } of plots.current.values()) pushCursor([u], idx, xs);
      }),
    [],
  );

  // Shared zoom → every plot.
  useEffect(
    () =>
      effect(() => {
        const range = zoomFor(frame, xZoom.value);
        for (const { u, xs } of plots.current.values()) applyZoom(u, range, xs);
      }),
    [frame],
  );

  // Gutter flash (hint/assist link → strip): 2 × 300 ms accent pulse, and bring it into view.
  useEffect(() => {
    if (!flashChannel) return;
    setFlashing(flashChannel);
    gutters.current.get(flashChannel)?.scrollIntoView?.({ block: 'nearest' });
    const t = setTimeout(() => setFlashing(null), 650);
    return () => clearTimeout(t);
  }, [flashChannel]);

  // Keep keyboard focus on a strip after it moves.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    gutters.current.get(id)?.focus();
  }, [strips]);

  // Hint band in axis units (time window mapped through the current run in distance mode).
  const hintRange = useMemo<[number, number] | null>(() => {
    if (!hintWindow || !current) return null;
    return [
      timeToAxis(current, hintWindow.tStart, axis, units),
      timeToAxis(current, hintWindow.tEnd, axis, units),
    ];
  }, [hintWindow?.tStart, hintWindow?.tEnd, current, axis, units]);

  const segBoundaries = useMemo(
    () => (segmentBoundaries ?? []).map((b) => axisValue(b, axis, units)),
    [segmentBoundaries, axis, units],
  );
  const segCfg = useMemo(() => {
    const any = segBoundaries.length > 0 || (segmentLabels?.length ?? 0) > 0;
    if (!any) return { bottom: null, other: null };
    return {
      bottom: { boundaries: segBoundaries, labels: segmentLabels, showLabels: true },
      other: { boundaries: segBoundaries, labels: segmentLabels, showLabels: false },
    };
  }, [segBoundaries, segmentLabels]);

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>, id: ChannelId) => {
    const list = stripsRef.current;
    const i = list.indexOf(id);
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const delta = ev.key === 'ArrowUp' ? -1 : 1;
      if (ev.altKey) {
        const next = moveBy(list, id, delta);
        if (next.indexOf(id) !== i) {
          focusAfter.current = id;
          change(next);
        }
      } else {
        const target = list[i + delta];
        if (target) gutters.current.get(target)?.focus();
      }
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      focusAfter.current = list[i + 1] ?? list[i - 1] ?? null;
      change(removeStrip(list, id));
      return;
    }
    if (handleCursorKey(ev, current?.n ?? 0)) ev.preventDefault();
  };

  // ←/→ and Esc on the stack itself (after clicking a plot, focus lands on the stack).
  const onStackKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return;
    if (handleCursorKey(ev, current?.n ?? 0)) ev.preventDefault();
  };

  // ---- drag and drop ----
  const dropIndexFor = (ev: DragEvent, index: number): number => {
    const el = ev.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    if (!rect || rect.height === 0) return index;
    return ev.clientY > rect.top + rect.height / 2 ? index + 1 : index;
  };
  const onRowDragOver = (ev: DragEvent, index: number) => {
    const p = readDrag(ev);
    if (!p) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    const at = dropIndexFor(ev, index);
    if (drop?.index !== at) setDrop({ index: at });
  };
  const onDrop = (ev: DragEvent, index?: number) => {
    const p = readDrag(ev);
    endDrag();
    setDrop(null);
    setDragId(null);
    if (!p) return;
    ev.preventDefault();
    ev.stopPropagation();
    const at = index === undefined ? stripsRef.current.length : dropIndexFor(ev, index);
    const next = insertStrip(stripsRef.current, p.id, at);
    if (next.join('\u0000') !== stripsRef.current.join('\u0000')) change(next);
  };

  const gutterProps = (id: ChannelId) => ({
    onRemove: () => change(removeStrip(stripsRef.current, id)),
    onDragStart: (ev: DragEvent) => {
      beginDrag(ev, { id, from: 'stack' });
      setDragId(id);
    },
    onDragEnd: () => {
      endDrag();
      setDragId(null);
      setDrop(null);
    },
    onKeyDown: (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>) => onKeyDown(ev, id),
    onFocus: () => {
      selectedStrip.value = id;
    },
    gutterRef: (el: HTMLDivElement | null) => {
      if (el) gutters.current.set(id, el);
      else gutters.current.delete(id);
    },
  });

  const pinned = cursorPinned.value;
  const isReplaying = replaying.value;
  const selected = selectedStrip.value;
  const entering = initialIds.current;

  return (
    <div
      class={`strips${pinned ? ' strips--pinned' : ''}${isReplaying ? ' strips--replay' : ''}`}
      role="list"
      aria-label="Telemetry strips"
      tabIndex={-1}
      onKeyDown={onStackKeyDown}
      onDragOver={(ev) => {
        const p = readDrag(ev);
        if (!p) return;
        ev.preventDefault();
        if (ev.target === ev.currentTarget && drop?.index !== strips.length) {
          setDrop({ index: strips.length });
        }
      }}
      onDragLeave={(ev) => {
        if (ev.target === ev.currentTarget) setDrop(null);
      }}
      onDrop={(ev) => onDrop(ev)}
      data-testid="strip-stack"
    >
      {strips.length === 0 && (
        <div class="strips__empty data faint">No strips. Add channels from the table.</div>
      )}
      {strips.map((id, index) => {
        const available = availableIds.has(id);
        const classes = [
          dragId === id ? 'strip--dragging' : '',
          selected === id ? 'strip--selected' : '',
          flashing === id ? 'strip--flash' : '',
          !entering.has(id) ? 'strip--enter' : '',
          drop?.index === index ? 'strip--drop-before' : '',
          drop?.index === index + 1 && index === strips.length - 1 ? 'strip--drop-after' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const rowEvents = {
          onDragOver: (ev: DragEvent) => onRowDragOver(ev, index),
          onDrop: (ev: DragEvent) => onDrop(ev, index),
          onPointerDown: () => {
            selectedStrip.value = id;
          },
        };
        if (!available) {
          return (
            <div
              key={id}
              role="listitem"
              class={`strip strip--placeholder ${classes}`}
              data-strip={id}
              {...rowEvents}
            >
              <StripPlaceholder id={id} {...gutterProps(id)} />
            </div>
          );
        }
        const meta = channelMeta(id);
        return (
          <div key={id} role="listitem" class="strip-slot" {...rowEvents}>
            <Strip
              id={id}
              slot={index}
              quantity={meta.quantity}
              label={meta.label}
              current={current}
              best={best}
              history={history}
              axis={axis}
              units={units}
              height={heights[id] ?? defaultH}
              showXAxis={id === bottomId}
              syncKey={syncKey}
              projector={projector}
              zoomFrame={frame}
              smooth={smoothed?.has(id) ?? false}
              hintRange={hintWindow && hintWindow.channel === id ? hintRange : null}
              segments={id === bottomId ? segCfg.bottom : segCfg.other}
              registerPlot={registerPlot}
              gutter={{ ...gutterProps(id), ...(gutterMenu ? { menu: gutterMenu(id) } : {}) }}
              onResize={(h) =>
                setHeights((prev) => ({
                  ...prev,
                  [id]: Math.max(MIN_H, Math.min(MAX_H, Math.round(h))),
                }))
              }
              class={classes}
            />
          </div>
        );
      })}
    </div>
  );
}
