/**
 * App-level wiring between the framework-free game layer and DOM-only UI modules (the game
 * layer may not import either, per the lint boundary):
 * - `prefs.projectorMode` → the `data-projector` attribute on `<html>` (report projector tokens);
 * - the telemetry registry → the report's channel label/quantity lookup.
 * Call once at startup. Returns a disposer (tests).
 */
import { onProjectorModeChange } from '@/game/prefs';
import { setChannelLookup } from '@/report/channel-meta';
import { setProjector } from '@/report/projector';
import { getChannel } from '@/telemetry/registry';

export function installAppBindings(): () => void {
  setChannelLookup(getChannel);
  return onProjectorModeChange(setProjector);
}
