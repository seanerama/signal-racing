/**
 * The 🔒 lock mark as an inline SVG in `currentColor`, so it renders identically everywhere
 * (emoji fonts are not guaranteed, and an emoji ignores the `--text-faint` colour).
 */
export function LockGlyph({ class: cls = '' }: { class?: string }) {
  return (
    <svg
      class={`lock-glyph ${cls}`}
      width="8"
      height="10"
      viewBox="0 0 8 10"
      role="img"
      aria-label="locked"
      fill="none"
      stroke="currentColor"
    >
      <title>locked</title>
      <path d="M2 4.5V3a2 2 0 0 1 4 0v1.5" stroke-width="1.2" />
      <rect x="0.5" y="4.5" width="7" height="5" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
