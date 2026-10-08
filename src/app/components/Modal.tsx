/**
 * A focus-trapped modal (design-system: modals in/out 120 ms; focus-trapped). Esc and a click on
 * the scrim call `onClose`. Focus returns to the previously focused element on close.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import '../screens.css';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  label: string;
  onClose(): void;
  width?: number;
  children: ComponentChildren;
  testId?: string;
  /** Vertical placement: centred (brief) or near the top (palette). */
  align?: 'center' | 'top';
}

export function Modal({
  label,
  onClose,
  width = 560,
  children,
  testId,
  align = 'center',
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first =
      ref.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      onClose();
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      class={`modal-scrim modal-scrim--${align}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{ width: `${width}px` }}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}
