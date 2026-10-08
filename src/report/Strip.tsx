/**
 * One strip (design-system "Strip"): gutter · uPlot plot · readout column.
 *
 * The uPlot instance is created only once the strip is visible (IntersectionObserver; immediately
 * where that is unavailable) and is rebuilt (destroyed + recreated) whenever a mount-time option
 * changes: units, projector, axis, slot, x-axis visibility, or the data. Height and width changes
 * use `setSize`. Data is never animated.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChannelId, Quantity } from '@/engine/types';
import type { RunTelemetry } from '@/telemetry/types';
import { precision, unitLabel, type UnitSystem } from '@/units';
import { attachPinOnClick, cursorBind, onPlotCursor } from './cursor';
import { deltaParts } from './DeltaValue';
import { cursorIdx } from './cursor-store';
import { hintBandPlugin } from './plugins/hint-band';
import { segmentRulesPlugin, type SegmentRulesConfig } from './plugins/segment-rules';
import { buildStripData, type Axis, type StripData } from './strip-data';
import { StripGutter, type StripGutterProps } from './StripGutter';
import { buildStripOptions, historySeries, slotToken, X_AXIS_H, X_AXIS_SEG_H } from './uplot-theme';
import { applyZoom, onPlotSelect, xZoom, zoomFor } from './zoom';

export interface StripProps {
  id: ChannelId;
  slot: number;
  quantity: Quantity;
  label: string;
  current: RunTelemetry | null;
  best: RunTelemetry | null;
  history?: RunTelemetry[];
  axis: Axis;
  units: UnitSystem;
  height: number;
  showXAxis: boolean;
  syncKey: string;
  projector: boolean;
  zoomFrame: string;
  /** Stage 9: display-only 5-point smoothing (`~` on the gutter and readouts). */
  smooth?: boolean;
  /** Hint band in x-axis units, or null. */
  hintRange: [number, number] | null;
  segments: SegmentRulesConfig | null;
  /** Registers/unregisters the live uPlot instance with the stack. */
  registerPlot(id: ChannelId, u: uPlot | null, xs: ArrayLike<number> | null): void;
  gutter: Omit<StripGutterProps, 'id' | 'label' | 'unit' | 'slot' | 'hue' | 'placeholder'>;
  onResize(height: number): void;
  class?: string;
}

/** True once the element has intersected the viewport (or immediately without IO support). */
function useVisibleOnce(ref: { current: Element | null }): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px 0px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  return visible;
}

function fmt(v: number | undefined, dp: number): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const s = v.toFixed(dp);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace('-', '−');
}

/** Current, best and Δ at the cursor: mono, right-aligned, tabular. The strip's text twin. */
function StripReadout({
  data,
  dp,
  unit,
  id,
  smooth = false,
}: {
  data: StripData | null;
  dp: number;
  unit: string;
  id: string;
  smooth?: boolean;
}) {
  const idx = cursorIdx.value;
  const cur = idx !== null && data ? data.cur[idx] : undefined;
  const best = idx !== null && data?.best ? data.best[idx] : undefined;
  const delta = cur !== undefined && best !== undefined ? cur - best : NaN;
  // Glyph + sign; zero after rounding is neutral (`±0.000`), never `▼−0.000`.
  const parts = Number.isFinite(delta) ? deltaParts(delta, dp) : null;
  const deltaText = parts ? `${parts.glyph}${parts.text}` : '—';
  // Smoothed readouts carry `~` so a displayed mean is never read as a raw sample.
  const mark = (v: number | undefined): string => {
    const s = fmt(v, dp);
    return smooth && s !== '—' ? `~${s}` : s;
  };
  return (
    <div
      class="strip__readout data"
      role="status"
      aria-label={`${id} at cursor${smooth ? ' (smoothed)' : ''}: current ${fmt(cur, dp)}, best ${fmt(best, dp)}${unit ? ` ${unit}` : ''}`}
    >
      <span class="strip__rd-cur">{mark(cur)}</span>
      <span class="strip__rd-best">{mark(best)}</span>
      <span class="strip__rd-delta">{deltaText}</span>
    </div>
  );
}

/** The x readout chip on the bottom axis (`1.240 s` / `412 m`). */
function CursorChip({
  plot,
  xs,
  axis,
  units,
  top,
}: {
  top: number;
  plot: uPlot | null;
  xs: ArrayLike<number> | null;
  axis: Axis;
  units: UnitSystem;
}) {
  const idx = cursorIdx.value;
  void xZoom.value; // re-position on zoom
  if (!plot || !xs || idx === null) return null;
  const x = xs[idx];
  if (x === undefined) return null;
  const left = plot.valToPos(x, 'x');
  const w = plot.bbox.width / (globalThis.devicePixelRatio || 1);
  if (!(left >= 0 && left <= w)) return null;
  const offset = plot.over.offsetLeft || 0;
  const q: Quantity = axis === 'time' ? 'time' : 'distance';
  const text = `${x.toFixed(precision(q, units))} ${unitLabel(q, units)}`;
  return (
    <span
      class="strip__xchip micro"
      style={{ left: `${offset + left}px`, top: `${top}px` }}
      data-testid="cursor-x"
    >
      {text}
    </span>
  );
}

export function Strip(props: StripProps) {
  const {
    id,
    slot,
    quantity,
    label,
    current,
    best,
    history,
    axis,
    units,
    height,
    showXAxis,
    syncKey,
    projector,
    zoomFrame,
    hintRange,
    segments,
    registerPlot,
    gutter,
    smooth = false,
  } = props;
  const rowRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const plotInst = useRef<uPlot | null>(null);
  const [plot, setPlot] = useState<uPlot | null>(null);
  const visible = useVisibleOnce(rowRef);

  const data = useMemo(
    () =>
      current
        ? buildStripData({ id, quantity, current, best, history, axis, units, smooth })
        : null,
    [id, quantity, current, best, history, axis, units, smooth],
  );

  // Plugins read the latest hint/segment config through refs, so they never force a rebuild.
  const hintRef = useRef(hintRange);
  const segRef = useRef(segments);
  hintRef.current = hintRange;
  segRef.current = segments;
  const heightRef = useRef(height);
  heightRef.current = height;
  // The bottom strip grows a band under the x-axis for segment labels.
  const segBand = showXAxis && !!segments?.showLabels && (segments.labels?.length ?? 0) > 0;
  const axisH = showXAxis ? X_AXIS_H + (segBand ? X_AXIS_SEG_H : 0) : 0;

  useEffect(() => {
    const el = plotRef.current;
    if (!visible || !el || !data) return;
    const opts = buildStripOptions({
      slot,
      quantity,
      units,
      height: heightRef.current,
      showXAxis,
      syncKey,
      projector,
    });
    if (segBand && opts.axes?.[0]) {
      opts.axes[0].size = X_AXIS_H + X_AXIS_SEG_H;
      opts.height += X_AXIS_SEG_H;
    }
    if (data.historyCount > 0) {
      opts.series.splice(1, 0, ...Array.from({ length: data.historyCount }, historySeries));
    }
    opts.width = Math.max(50, el.clientWidth || 600);
    opts.plugins = [
      hintBandPlugin(() => hintRef.current),
      segmentRulesPlugin(() => segRef.current),
    ];
    opts.cursor = { ...opts.cursor, bind: cursorBind() };
    opts.hooks = {
      setCursor: [onPlotCursor],
      setSelect: [(u) => onPlotSelect(u, zoomFrame)],
    };
    const u = new uPlot(opts, data.data, el);
    plotInst.current = u;
    setPlot(u);
    applyZoom(u, zoomFor(zoomFrame), data.x);
    const detachPin = attachPinOnClick(u);
    registerPlot(id, u, data.x);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        const h = heightRef.current + axisH;
        if (w > 0 && (w !== u.width || h !== u.height)) u.setSize({ width: w, height: h });
      });
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      detachPin();
      registerPlot(id, null, null);
      plotInst.current = null;
      setPlot(null);
      u.destroy();
    };
  }, [
    visible,
    data,
    slot,
    quantity,
    units,
    showXAxis,
    segBand,
    axisH,
    syncKey,
    projector,
    zoomFrame,
    id,
    registerPlot,
  ]);

  // Height changes resize, not rebuild.
  useEffect(() => {
    const u = plotInst.current;
    if (!u) return;
    const h = height + axisH;
    if (u.height !== h) u.setSize({ width: u.width, height: h });
  }, [height, axisH, plot]);

  // Hint/segment changes redraw in place.
  useEffect(() => {
    plotInst.current?.redraw(false, false);
  }, [hintRange?.[0], hintRange?.[1], segments, plot]);

  // Resize by dragging the bottom edge (48–160 px).
  const onResizeStart = (ev: PointerEvent) => {
    ev.preventDefault();
    const startY = ev.clientY;
    const startH = height;
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture?.(ev.pointerId);
    const move = (e: PointerEvent) => props.onResize(startH + (e.clientY - startY));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const unit = unitLabel(quantity, units);
  const dp = precision(quantity, units);
  const hue = `var(${slotToken(slot)})`;
  return (
    <div
      ref={rowRef}
      class={`strip${props.class ? ` ${props.class}` : ''}`}
      data-strip={id}
      style={{ '--strip-hue': hue }}
    >
      <StripGutter
        {...gutter}
        id={id}
        label={label}
        unit={unit}
        slot={slot}
        hue={hue}
        smoothed={smooth}
      />
      <div class="strip__plot" style={{ height: `${height + axisH}px` }}>
        <div class="strip__canvas" ref={plotRef} aria-hidden="true" />
        {!current && <span class="strip__empty micro faint">no run</span>}
        {showXAxis && (
          <CursorChip top={height + 4} plot={plot} xs={data?.x ?? null} axis={axis} units={units} />
        )}
      </div>
      <StripReadout data={data} dp={dp} unit={unit} id={id} smooth={smooth} />
      <div
        class="strip__resize"
        aria-hidden="true"
        onPointerDown={onResizeStart}
        title="Drag to resize"
      />
    </div>
  );
}
