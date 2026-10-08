/**
 * The active screen's actions, for the global keyboard map and the command palette. The
 * workbench registers itself while mounted; other screens leave it null.
 */
import { signal } from '@preact/signals';
import type { ChannelId } from '@/engine/types';

export interface WorkbenchActions {
  run(): void;
  toggleHint(): void;
  addChannel(id: ChannelId): void;
  openBrief(): void;
  channels: readonly ChannelId[];
  inStack: ReadonlySet<ChannelId>;
}

export const workbenchActions = signal<WorkbenchActions | null>(null);

/** Overlays owned by the shell. */
export const paletteOpen = signal(false);
export const shortcutsOpen = signal(false);
