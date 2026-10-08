/**
 * Level-aware glue for the assist (pure): which channels it ranks, which are echoes, and how a
 * rule's observe tier becomes a one-line reason.
 */
import type { ChannelId } from '@/engine/types';
import { renderTier, ruleFor } from '@/hints/engine';
import type { HintMatch } from '@/hints/types';
import type { LevelConfig } from '@/levels/types';
import { getChannel, hasChannel } from '@/telemetry/registry';
import type { UnitSystem } from '@/units/index';

/**
 * The channels the assist ranks: the level's set minus its outcome channels (`segment_time`,
 * `delta_best`, `top_speed` move with lap time by definition, so ranking them says nothing).
 */
export function assistChannels(level: LevelConfig): ChannelId[] {
  return level.channelSet.filter((id) => level.channelRoles[id] !== 'outcome');
}

/** A distractor built to correlate with speed or throttle while explaining nothing. */
export function isEchoChannel(id: ChannelId): boolean {
  if (!hasChannel(id)) return false;
  const src = getChannel(id).source;
  return (
    src.kind === 'distractor' && (src.family === 'speed_echo' || src.family === 'throttle_echo')
  );
}

/** `describe` for `rankChannels`: the rule's observe tier, rendered in the player's units. */
export function describer(level: LevelConfig, units: UnitSystem): (m: HintMatch) => string | null {
  return (m) => {
    const rule = ruleFor(level, m);
    return rule ? renderTier(rule, m, 0, units).text : null;
  };
}
