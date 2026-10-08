/**
 * The "Waterfall…" overlay, opened from a strip's gutter menu: a `--panel` dialog holding the run
 * waterfall for one channel. Esc or ✕ closes it (and disposes the WebGL context). three.js loads
 * on first open.
 */
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { channelMeta } from '@/report/channel-meta';
import { unitLabel } from '@/units';
import { openWaterfall } from './index';
import type { WaterfallProps } from './types';
import { useView } from './use-view';

export interface WaterfallOverlayProps extends WaterfallProps {
  onClose(): void;
}

export function WaterfallOverlay(props: WaterfallOverlayProps) {
  const { onClose, runs, channel, units, axis, slot, levers, bestIndex } = props;
  const viewProps = useMemo<WaterfallProps>(
    () => ({
      runs,
      channel,
      units,
      axis,
      slot,
      ...(levers ? { levers } : {}),
      ...(bestIndex !== undefined ? { bestIndex } : {}),
    }),
    [runs, channel, units, axis, slot, levers, bestIndex],
  );
  const { ref, status } = useView(openWaterfall, viewProps);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  const unit = unitLabel(channelMeta(channel).quantity, units);
  return (
    <div
      class="wf-overlay"
      data-testid="waterfall-overlay"
      onPointerDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        class="wf-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Waterfall: ${channel} across ${runs.length} runs`}
      >
        <div class="wf-panel__head">
          <span class="wf-panel__title h2">Waterfall</span>
          <span class="wf-panel__channel data">
            {channel}
            {unit && <span class="dim micro">{` ${unit}`}</span>}
          </span>
          <span class="micro dim">{`${runs.length} run${runs.length === 1 ? '' : 's'}`}</span>
          <span class="wf-panel__hint micro">drag to orbit · wheel to zoom · Esc closes</span>
          <button
            ref={closeRef}
            type="button"
            class="wf-panel__close"
            aria-label="Close waterfall"
            title="Close (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div class="wf-panel__view" style={{ position: 'relative' }}>
          <div
            ref={ref}
            class="viz3d"
            style={{ position: 'absolute', inset: 0 }}
            data-testid="waterfall-view"
          />
          {status !== 'ready' && (
            <span class="viz3d-status micro">
              {status === 'error' ? '3D view failed to load' : 'loading 3D…'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
