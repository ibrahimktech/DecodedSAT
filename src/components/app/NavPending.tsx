"use client";

/**
 * The "your click landed" dot in the nav rail.
 *
 * `useLinkStatus` reports the pending state of the nearest ancestor `<Link>`,
 * so this must render *inside* the Link, not beside it — the hook has no other
 * way to find which link it belongs to.
 *
 * Mostly this renders nothing visible, and that is the intended outcome: once
 * a route's `loading.tsx` shell has been prefetched, the navigation commits
 * immediately, `usePathname()` moves the active highlight on the same frame,
 * and the pending state is skipped entirely. This covers the cases prefetching
 * cannot — a cold load where the shell has not arrived yet, or a slow network
 * where it is still in flight — which are exactly the moments the rail would
 * otherwise sit there looking inert.
 *
 * Styling lives in `globals.css` rather than Tailwind classes because the
 * debounce is an animation delay on a keyframe pair, which has no utility
 * equivalent.
 */

import { useLinkStatus } from "next/link";

export function NavPending() {
  const { pending } = useLinkStatus();

  return (
    <span aria-hidden className={`nav-hint ${pending ? "is-pending" : ""}`} />
  );
}
