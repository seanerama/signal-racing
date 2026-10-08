/**
 * Channel label/quantity lookup for the report UI.
 *
 * The report needs each channel's `label` and `quantity` (units, precision, filter by label).
 * The source of truth is the Stage 3 registry (`getChannel` in `src/telemetry/registry.ts`),
 * which Stage 4 must not import. So the lookup is injected: the app (Stage 6) calls
 * `setChannelLookup(getChannel)` once at startup (a `ChannelDef` satisfies `ChannelMeta`), and
 * the dev route registers the fixture metadata. Unknown ids fall back to a unitless channel
 * labelled with its id, so a stale saved layout never throws.
 */
import type { ChannelId, Quantity } from '@/engine/types';

export interface ChannelMeta {
  label: string;
  quantity: Quantity;
}

export type ChannelLookup = (id: ChannelId) => ChannelMeta | undefined;

let lookup: ChannelLookup = () => undefined;

/** Installs the channel lookup. A lookup that throws on unknown ids (like `getChannel`) is fine. */
export function setChannelLookup(fn: ChannelLookup): void {
  lookup = fn;
}

/** Label and quantity for `id`; never throws. */
export function channelMeta(id: ChannelId): ChannelMeta {
  try {
    const m = lookup(id);
    if (m) return { label: m.label, quantity: m.quantity };
  } catch {
    // unknown id in the registry: fall through to the placeholder meta
  }
  return { label: id, quantity: 'dimensionless' };
}
