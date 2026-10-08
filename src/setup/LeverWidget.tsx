/**
 * Lever widget (design-system "Lever widget"): label with an accent dot when the value differs
 * from the last run, ◀ value ▶ with click-to-type (Enter commits, Esc reverts, invalid shakes once
 * and reverts), and a discrete track with a tick per step, a ghost ◇ at the last run's value and
 * the thumb. Drag the track, click a tick, or press ←/→ (Shift = 5 steps) while focused.
 * Locked levers render faint with 🔒, the value and no track.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { LeverSpec } from '@/levels/types';
import { LockGlyph } from '@/report/LockGlyph';
import { formatValue, unitLabel, type UnitSystem } from '@/units';
import { fractionOf, indexOf, parseTyped, stepBy, stepCount, valueAt } from './lever-math';
import './setup.css';

export interface LeverWidgetProps {
  spec: LeverSpec;
  value: number;
  units: UnitSystem;
  onChange?(next: number): void;
  /** Value used in the previous run (ghost ◇); omitted before the first run. */
  lastValue?: number | null;
  locked?: boolean;
  disabled?: boolean;
}

export function LeverWidget({
  spec,
  value,
  units,
  onChange,
  lastValue = null,
  locked = false,
  disabled = false,
}: LeverWidgetProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [shake, setShake] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const display = formatValue(spec.quantity, units, value);
  const changed = lastValue !== null && Math.abs(lastValue - value) > spec.step / 1000;
  const id = `lever-${spec.id}`;

  if (locked) {
    return (
      <div class="lever lever--locked" data-lever={spec.id} aria-disabled="true">
        <div class="lever__head">
          <span class="lever__label">
            {spec.label} <LockGlyph />
          </span>
        </div>
        <div class="lever__value data" data-testid={`lever-value-${spec.id}`}>
          {display}
        </div>
      </div>
    );
  }

  const set = (v: number) => {
    if (disabled) return;
    if (Math.abs(v - value) > 1e-12) onChange?.(v);
  };

  const commitText = () => {
    const parsed = parseTyped(spec, text, units);
    if (parsed === null) {
      setShake(true);
      setTimeout(() => setShake(false), 300);
      setEditing(false);
      return;
    }
    setEditing(false);
    set(parsed);
  };

  const fromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    set(valueAt(spec, Math.round(f * stepCount(spec))));
  };

  const onTrackKey = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const big = ev.shiftKey ? 5 : 1;
    let next: number | null = null;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') next = stepBy(spec, value, big);
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') next = stepBy(spec, value, -big);
    else if (ev.key === 'Home') next = spec.min;
    else if (ev.key === 'End') next = spec.max;
    if (next === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    set(next);
  };

  const n = stepCount(spec);
  const ticks = Array.from({ length: n + 1 }, (_, i) => i);
  const lastIdx = lastValue === null ? null : indexOf(spec, lastValue);

  return (
    <div class={`lever${disabled ? ' lever--disabled' : ''}`} data-lever={spec.id}>
      <div class="lever__head">
        <label class="lever__label" id={`${id}-label`} for={`${id}-track`}>
          {spec.label}
        </label>
        {changed && (
          <span class="lever__dot" title="Changed since the last run" aria-label="changed" />
        )}
      </div>
      <div class="lever__row">
        <button
          type="button"
          class="lever__step"
          aria-label={`Decrease ${spec.label}`}
          disabled={disabled || value <= spec.min + 1e-12}
          onClick={() => set(stepBy(spec, value, -1))}
        >
          ◀
        </button>
        {editing ? (
          <input
            class="lever__input data"
            aria-label={`${spec.label} (${unitLabel(spec.quantity, units)})`}
            value={text}
            autoFocus
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitText();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={() => setEditing(false)}
            data-testid={`lever-input-${spec.id}`}
          />
        ) : (
          <button
            type="button"
            class={`lever__value data${shake ? ' lever__value--shake' : ''}`}
            title="Click to type a value"
            disabled={disabled}
            onClick={() => {
              setText(formatValue(spec.quantity, units, value, { withUnit: false }));
              setEditing(true);
            }}
            data-testid={`lever-value-${spec.id}`}
          >
            {display}
          </button>
        )}
        <button
          type="button"
          class="lever__step"
          aria-label={`Increase ${spec.label}`}
          disabled={disabled || value >= spec.max - 1e-12}
          onClick={() => set(stepBy(spec, value, 1))}
        >
          ▶
        </button>
      </div>
      <div
        ref={trackRef}
        id={`${id}-track`}
        class="lever__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        aria-valuetext={display}
        aria-disabled={disabled || undefined}
        onKeyDown={onTrackKey}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromPointer(e.clientX);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        data-testid={`lever-track-${spec.id}`}
      >
        <span class="lever__rail" />
        <span class="lever__fill" style={{ width: `${fractionOf(spec, value) * 100}%` }} />
        {ticks.map((i) => (
          <span
            key={i}
            class="lever__tick"
            style={{ left: `${n === 0 ? 0 : (i / n) * 100}%` }}
            data-value={valueAt(spec, i)}
          />
        ))}
        {lastIdx !== null && (
          <span
            class="lever__ghost"
            style={{ left: `${n === 0 ? 0 : (lastIdx / n) * 100}%` }}
            title={`Last run: ${formatValue(spec.quantity, units, lastValue ?? 0)}`}
            data-testid={`lever-ghost-${spec.id}`}
          >
            ◇
          </span>
        )}
        <span class="lever__thumb" style={{ left: `${fractionOf(spec, value) * 100}%` }} />
      </div>
    </div>
  );
}
