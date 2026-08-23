/**
 * Icons shared by the exam chrome.
 *
 * Inline SVG rather than an icon package, matching `NavRail` — these are a
 * handful of shapes and a dependency would be the larger thing.
 */

/**
 * The mark-for-review flag.
 *
 * Filled rather than stroked because it has to read at 12px, which is the size
 * it appears at as a corner badge in the navigator grid. A 2px outline at that
 * size is mostly hole.
 */
export function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}
