/**
 * The selected strip (design-system "Strip": selected = `--focus` 1px outline). Shared so the
 * track view can colour its path by the selected strip's channel without a new prop on the
 * frozen StripStack contract: the parent passes `colorBy={selectedStrip.value}` to TrackView.
 */
import { signal, type Signal } from '@preact/signals';
import type { ChannelId } from '@/engine/types';

export const selectedStrip: Signal<ChannelId | null> = signal<ChannelId | null>(null);
