/**
 * Strip gutter (design-system "Strip"): drag handle `⋮⋮`, channel id (mono), unit (micro, dim),
 * slot tag, and a remove `✕` revealed on hover/focus. A 3px left border in the trace hue ties the
 * label to the line. The gutter is the strip's keyboard focus target.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GutterMenuItem } from './types';

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
  /** Optional menu behind a `⋯` button (revealed on hover/focus, like remove). */
  menu?: GutterMenuItem[];
  children?: ComponentChildren;
}

/**
 * The gutter's `⋯` menu: a small popover list (`role="menu"`). Keys stay inside it, so the
 * gutter's own Arrow/Delete handling never fires while it is open. Esc or a click outside closes.
 */
function GutterMenu({ id, items }: { id: string; items: GutterMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (ev: PointerEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const onMenuKey = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    ev.stopPropagation();
    const list = [
      ...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close(true);
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = list.length;
      list[(i + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
    } else if (ev.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div class="strip__menu" ref={rootRef} onKeyDown={onMenuKey} draggable={false}>
      <button
        ref={btnRef}
        type="button"
        class={`strip__menu-btn${open ? ' strip__menu-btn--open' : ''}`}
        aria-label={`${id} strip menu`}
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={-1}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') ev.stopPropagation();
        }}
      >
        ⋯
      </button>
      {open && (
        <div class="strip__menu-list" role="menu" aria-label={`${id} strip menu`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              class="strip__menu-item data"
              onClick={(ev) => {
                ev.stopPropagation();
                close(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  menu,
  children,
}: StripGutterProps) {
  return (
    <div
      class="strip__gutter"
      ref={gutterRef}
      tabIndex={0}
      role="group"
      aria-label={`${id} strip${unit ? `, ${unit}` : ''}. Alt+Up/Down reorders, Delete removes.${menu?.length ? ' Shift+F10 opens the menu.' : ''}`}
      data-strip-gutter={id}
      style={hue ? { borderLeftColor: hue } : undefined}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(ev) => {
        // The context-menu key (or Shift+F10) opens the gutter menu from the keyboard.
        if (menu?.length && (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10'))) {
          ev.preventDefault();
          ev.currentTarget.querySelector<HTMLButtonElement>('.strip__menu-btn')?.click();
          return;
        }
        onKeyDown(ev);
      }}
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
      {!placeholder && menu && menu.length > 0 && <GutterMenu id={id} items={menu} />}
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
