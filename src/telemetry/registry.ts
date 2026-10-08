/**
 * The channel registry (contract 03): physical channels (contract 02), derived math channels, and
 * the distractor library. Registry order is physical → derived → distractors, each in its
 * declaration order; `RunTelemetry.channelIds` and the CSV columns follow it.
 */
import type { ChannelId } from '@/engine/types';
import type { RegisteredChannel } from './def';
import { DERIVED_DEFS } from './derived';
import { DISTRACTOR_DEFS } from './distractor-defs';
import { PHYSICAL_DEFS } from './physical-defs';
import type { ChannelDef } from './types';

/** Group display order (the channel table and the dev listing use it). */
export const GROUP_ORDER: readonly ChannelDef['group'][] = [
  'timing',
  'chassis',
  'tires',
  'aero',
  'powertrain',
  'brakes',
  'electrical',
  'environment',
  'misc',
];

const ALL: readonly RegisteredChannel[] = Object.freeze([
  ...PHYSICAL_DEFS,
  ...DERIVED_DEFS,
  ...DISTRACTOR_DEFS,
]);

const BY_ID = new Map<ChannelId, RegisteredChannel>();
const INDEX = new Map<ChannelId, number>();
ALL.forEach((d, i) => {
  if (BY_ID.has(d.id)) throw new Error(`duplicate channel id '${d.id}'`);
  BY_ID.set(d.id, d);
  INDEX.set(d.id, i);
});

function entry(id: ChannelId): RegisteredChannel {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`unknown channel id '${id}'`);
  return d;
}

/** The channel's definition. Throws on an unknown id. */
export function getChannel(id: ChannelId): ChannelDef {
  return entry(id);
}

/** Every registered channel, in registry order. */
export function allChannels(): readonly ChannelDef[] {
  return ALL;
}

export function hasChannel(id: ChannelId): boolean {
  return BY_ID.has(id);
}

/** Nominal SI range `[lo, hi]` of a channel (noise scale; a sane default axis). Throws on an unknown id. */
export function channelRange(id: ChannelId): readonly [number, number] {
  return entry(id).range;
}

/** Quantisation step (SI) of a digital channel, or `undefined` for analogue channels. */
export function channelQuantum(id: ChannelId): number | undefined {
  return entry(id).quantum;
}

/** Position of a channel in registry order. Throws on an unknown id. */
export function registryIndex(id: ChannelId): number {
  const i = INDEX.get(id);
  if (i === undefined) throw new Error(`unknown channel id '${id}'`);
  return i;
}

/** Sorts ids into registry order (throws on an unknown id); duplicates are removed. */
export function inRegistryOrder(ids: Iterable<ChannelId>): ChannelId[] {
  const unique = [...new Set(ids)];
  for (const id of unique) registryIndex(id); // throws on an unknown id
  return unique.sort((a, b) => registryIndex(a) - registryIndex(b));
}
