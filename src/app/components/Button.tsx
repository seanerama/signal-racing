import type { ComponentChildren, JSX } from 'preact';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'hint';
/** `run` 32px (RUN), `default` 28px, `compact` 24px (tables). */
export type ButtonSize = 'run' | 'default' | 'compact';

export interface ButtonProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'size' | 'children'
> {
  /** design-system.md "Buttons": primary (one per screen), secondary, ghost, hint tier. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy: shows `busyLabel` and a thin bar inside the button; the button is disabled. */
  busy?: boolean;
  busyLabel?: string;
  /** 0–1 for a determinate busy bar (e.g. grid search); omitted = indeterminate. */
  progress?: number;
  /** Hint tier: run cost badge (`−1`) in `--warn`. */
  cost?: number;
  /** Hint tier: opened tiers render pressed. */
  pressed?: boolean;
  children?: ComponentChildren;
}

/** The app's one button. Styled only with tokens. */
export function Button({
  variant = 'secondary',
  size = 'default',
  busy = false,
  busyLabel,
  progress,
  cost,
  pressed,
  disabled,
  type = 'button',
  class: className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`];
  if (busy) classes.push('btn--busy');
  if (pressed) classes.push('btn--pressed');
  if (typeof className === 'string' && className) classes.push(className);
  const determinate = progress !== undefined;
  return (
    <button
      {...rest}
      type={type}
      class={classes.join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-pressed={pressed ?? undefined}
    >
      <span class="btn__label">{busy && busyLabel ? busyLabel : children}</span>
      {cost !== undefined && (
        <span class="btn__cost mono" aria-label={`costs ${cost} run${cost === 1 ? '' : 's'}`}>
          {`−${cost}`}
        </span>
      )}
      {busy && (
        <span
          class={`btn__bar ${determinate ? 'btn__bar--det' : 'btn__bar--indet'}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? Math.round(progress * 100) : undefined}
          style={determinate ? { width: `${Math.round(progress * 100)}%` } : undefined}
        />
      )}
    </button>
  );
}
