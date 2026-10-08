/**
 * Strip gutter (design-system "Strip"): drag handle `⋮⋮`, channel id (mono), unit (micro, dim),
 * slot tag, and a remove `✕` revealed on hover/focus. A 3px left border in the trace hue ties the
 * label to the line. The gutter is the strip's keyboard focus target.
 */
import type { ComponentChildren, JSX } from 'preact';

export interface StripGutterProps {
  id: string;
  label: string;
  unit: string;
  /** 0-based slot; shown as `T1…T8`. Null for placeholders. */
  slot: number | null;
  /** CSS colour (a token reference) for the hue border. */
  hue?: string;
  onRemove(): void;
  onDragStart(ev: DragEvent): void;
  onDragEnd(): void;
  onKeyDown(ev: JSX.TargetedKeyboardEvent<HTMLDivElement>): void;
  onFocus(): void;
  gutterRef?: (el: HTMLDivElement | null) => void;
  /** Collapsed "not on this car" row (see StripPlaceholder). */
  placeholder?: boolean;
  children?: ComponentChildren;
}

export function StripGutter({
  id,
  label,
  unit,
  slot,
  hue,
  onRemove,
  onDragStart,
  onDragEnd,
  onKeyDown,
  onFocus,
  gutterRef,
  placeholder = false,
  children,
}: StripGutterProps) {
  return (
    <div
      class="strip__gutter"
      ref={gutterRef}
      tabIndex={0}
      role="group"
      aria-label={`${id} strip${unit ? `, ${unit}` : ''}. Alt+Up/Down reorders, Delete removes.`}
      data-strip-gutter={id}
      style={hue ? { borderLeftColor: hue } : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      title={label}
    >
      <span class="strip__handle" aria-hidden="true">
        ⋮⋮
      </span>
      {placeholder ? (
        <span class="strip__placeholder-text data" data-testid={`strip-placeholder-${id}`}>
          {`${id}: not on this car`}
        </span>
      ) : (
        <div class="strip__names">
          <span class="strip__id data">{id}</span>
          <span class="strip__meta micro">
            <span class="strip__unit">{unit || '—'}</span>
            {slot !== null && <span class="strip__slot">{`T${(slot % 8) + 1}`}</span>}
          </span>
          {children}
        </div>
      )}
      <button
        type="button"
        class="strip__remove"
        aria-label={`Remove ${id}`}
        title={`Remove ${id}`}
        tabIndex={-1}
        onClick={(ev) => {
          ev.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </div>
  );
}
