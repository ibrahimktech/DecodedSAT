/**
 * The one grey block every loading skeleton is built from.
 *
 * Skeletons exist because every route under `(app)` is dynamic, and a dynamic
 * route with no Suspense boundary gives `<Link>` nothing to prefetch — the
 * router holds the old page on screen until the whole RSC payload lands, so
 * the click reads as dead. A `loading.tsx` fixes both halves at once: it is
 * the fallback React paints immediately, and its presence is what makes the
 * route partially prefetchable in the first place.
 *
 * `motion-safe:` rather than a bare `animate-pulse`: a pulsing page is exactly
 * the kind of thing `prefers-reduced-motion` is for, and a static block still
 * communicates "content goes here". The colour is the `hairline` token at 60%
 * so the same block reads correctly on both `surface` (white cards) and
 * `background` (the warm off-white page).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`motion-safe:animate-pulse rounded-lg bg-hairline/60 ${className}`}
    />
  );
}

/**
 * Wrapper for a `loading.tsx` root.
 *
 * Every skeleton block is `aria-hidden`, which would otherwise leave the whole
 * fallback silent to a screen reader — the page would simply appear to be
 * empty. This announces the wait once, politely, and marks the region busy.
 */
export function SkeletonPage({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}
