/**
 * Pure strip-order operations. Each returns a new array (the input is never mutated), which
 * StripStack passes to `onStripsChange`.
 */
import type { ChannelId } from '@/engine/types';

export function removeStrip(list: readonly ChannelId[], id: ChannelId): ChannelId[] {
  return list.filter((x) => x !== id);
}

/**
 * Inserts `id` so that it lands before the strip currently at `at` (0…length; `length` appends).
 * If `id` is already in the list it is moved, and `at` refers to the list *before* the move.
 */
export function insertStrip(list: readonly ChannelId[], id: ChannelId, at: number): ChannelId[] {
  const from = list.indexOf(id);
  const clamped = Math.max(0, Math.min(list.length, Math.floor(at)));
  if (from < 0) {
    const next = list.slice();
    next.splice(clamped, 0, id);
    return next;
  }
  const target = from < clamped ? clamped - 1 : clamped;
  if (target === from) return list.slice();
  const next = list.slice();
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}

/** Moves `id` up (`delta < 0`) or down by `delta` places, clamped. */
export function moveBy(list: readonly ChannelId[], id: ChannelId, delta: number): ChannelId[] {
  const from = list.indexOf(id);
  if (from < 0) return list.slice();
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return list.slice();
  const next = list.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Toggles `id`: removes it if present, otherwise appends it. */
export function toggleStrip(list: readonly ChannelId[], id: ChannelId): ChannelId[] {
  return list.includes(id) ? removeStrip(list, id) : [...list, id];
}
