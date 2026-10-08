import type { JSX } from 'preact';
import './SegmentedControl.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange(next: T): void;
  /** Accessible name for the group, e.g. "Units". */
  label: string;
  disabled?: boolean;
  compact?: boolean;
}

/**
 * Generic segmented control (Units, Axis). A radiogroup: click a segment, or use ←/→ while
 * focused. Switching is instant (no animation).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  compact = false,
}: SegmentedControlProps<T>) {
  const index = options.findIndex((o) => o.value === value);

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (disabled || options.length === 0) return;
    const step =
      ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
        ? 1
        : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    ev.preventDefault();
    const nextIdx = (Math.max(index, 0) + step + options.length) % options.length;
    const next = options[nextIdx];
    if (!next) return;
    onChange(next.value);
    const buttons = ev.currentTarget.querySelectorAll<HTMLButtonElement>('button');
    buttons[nextIdx]?.focus();
  };

  return (
    <div
      class={`seg${compact ? ' seg--compact' : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            class={`seg__item${checked ? ' seg__item--on' : ''}`}
            aria-checked={checked}
            tabIndex={checked || (index < 0 && i === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!checked) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
