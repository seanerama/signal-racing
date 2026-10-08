/**
 * Projector-mode detection for the report. Projector mode is set by the app (Stage 5/6 prefs) as
 * a `data-projector` attribute on the root element, which swaps the tokens. The report only
 * observes it, so strips can rebuild (uPlot options are mount-time).
 */
import { useEffect, useState } from 'preact/hooks';

export const PROJECTOR_ATTR = 'data-projector';

export function isProjector(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(PROJECTOR_ATTR);
}

/** Sets or clears projector mode on the root element (the dev route uses this). */
export function setProjector(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute(PROJECTOR_ATTR, '');
  else document.documentElement.removeAttribute(PROJECTOR_ATTR);
}

/** Re-renders when the root's `data-projector` attribute changes. */
export function useProjectorMode(): boolean {
  const [on, setOn] = useState(isProjector);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => setOn(isProjector()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: [PROJECTOR_ATTR] });
    setOn(isProjector());
    return () => mo.disconnect();
  }, []);
  return on;
}
