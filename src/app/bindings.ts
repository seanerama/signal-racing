/**
 * App-level wiring between the framework-free game layer and DOM-only UI modules (the game
 * layer may not import either, per the lint boundary):
 * - `prefs.projectorMode` → the `data-projector` attribute on `<html>` (report projector tokens);
 * - `prefs.density` → the `data-density` attribute on `<html>` (Stage 10 Compact density);
 * - the `?playback=instant|realtime` URL flag → `prefs.playbackMode` (Stage 10; e2e and tests);
 * - the telemetry registry → the report's channel label/quantity lookup;
 * - `window.__SIGNAL_PLAYBACK__` → playback frame timings (the Stage 10 perf check).
 * Call once at startup. Returns a disposer (tests).
 */
import { onDensityChange, onProjectorModeChange, playbackMode } from '@/game/prefs';
import { setChannelLookup } from '@/report/channel-meta';
import { frameStats, resetFrameStats } from '@/report/playback';
import { setProjector } from '@/report/projector';
import { getChannel } from '@/telemetry/registry';

/** Reads `playback=instant|realtime` from the query string or the hash's query. */
export function readPlaybackFlag(
  loc: Pick<Location, 'search' | 'hash'> | undefined,
): 'instant' | 'realtime' | null {
  if (!loc) return null;
  const hashQuery = loc.hash.includes('?') ? loc.hash.slice(loc.hash.indexOf('?')) : '';
  for (const q of [loc.search, hashQuery]) {
    const v = new URLSearchParams(q).get('playback');
    if (v === 'instant' || v === 'realtime') return v;
  }
  return null;
}

declare global {
  var __SIGNAL_PLAYBACK__: { stats: typeof frameStats; reset: typeof resetFrameStats } | undefined;
}

export function installAppBindings(): () => void {
  setChannelLookup(getChannel);
  const flag = readPlaybackFlag(globalThis.location);
  if (flag) playbackMode.value = flag;
  globalThis.__SIGNAL_PLAYBACK__ = { stats: frameStats, reset: resetFrameStats };
  const offProjector = onProjectorModeChange(setProjector);
  const offDensity = onDensityChange((d) => {
    if (typeof document === 'undefined') return;
    if (d === 'compact') document.documentElement.setAttribute('data-density', 'compact');
    else document.documentElement.removeAttribute('data-density');
  });
  return () => {
    offProjector();
    offDensity();
  };
}
