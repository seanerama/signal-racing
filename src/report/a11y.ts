/**
 * `aria-live` announcer (design-system "Accessibility"). One visually hidden polite live region,
 * created lazily on first use. The run result is announced through it, e.g.
 * "Run 3, 14.732 seconds, 0.211 faster than best, 0.084 over target."
 */

let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (region && region.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('role', 'status');
  region.setAttribute('data-testid', 'report-announcer');
  region.className = 'visually-hidden';
  document.body.appendChild(region);
  return region;
}

/** Announces `message` politely. Re-announcing identical text still triggers screen readers. */
export function announce(message: string): void {
  const el = ensureRegion();
  if (!el) return;
  // Clear first so an identical message is announced again.
  el.textContent = '';
  el.textContent = message;
}

/** The last announced text (tests). */
export function lastAnnouncement(): string {
  return region?.textContent ?? '';
}

/** Spoken run summary: "Run 3, 14.732 seconds, 0.211 faster than best, 0.084 over target." */
export function runAnnouncement(args: {
  index: number;
  time: number;
  bestTime: number | null;
  target: number | null;
}): string {
  const parts = [`Run ${args.index}`, `${args.time.toFixed(3)} seconds`];
  if (args.bestTime !== null && Number.isFinite(args.bestTime)) {
    const d = args.time - args.bestTime;
    parts.push(
      Math.abs(d) < 0.0005
        ? 'equal to best'
        : `${Math.abs(d).toFixed(3)} ${d < 0 ? 'faster' : 'slower'} than best`,
    );
  }
  if (args.target !== null && Number.isFinite(args.target)) {
    const d = args.time - args.target;
    parts.push(d <= 0 ? `${Math.abs(d).toFixed(3)} under target` : `${d.toFixed(3)} over target`);
  }
  return `${parts.join(', ')}.`;
}
