import type { Metadata } from "next";
import Link from "next/link";
import { NavRail } from "@/components/app/NavRail";
import { TimeZoneSync } from "@/components/app/TimeZoneSync";
import { getIsAdmin } from "@/lib/auth/admin";
import { requireOnboarded } from "@/lib/auth/require-onboarded";
import { requireUser } from "@/lib/auth/require-user";

/**
 * KaTeX's stylesheet, imported once per surface that renders question
 * content. Next dedupes the import, so listing it in both app shells costs
 * nothing and keeps the landing page — which renders no math — from carrying
 * it. The fonts it references are resolved as bundled assets and fetched by
 * the browser only when a glyph actually needs one.
 */
import "katex/dist/katex.min.css";

/**
 * Shell for the signed-in product.
 *
 * The `(app)` route group exists to keep this surface separate from the
 * landing page from day one. It is moving to `app.<domain>.com`, and having the
 * boundary drawn now means that move is a matter of lifting this directory out
 * rather than untangling it from the marketing pages. Only shared brand pieces
 * (mascot, button geometry) cross the line — no landing sections.
 *
 * `requireUser()` here is one of three layers, not the layer: the proxy
 * redirects signed-out visitors as a convenience, each page re-checks through
 * the same request-cached call, and Row Level Security underneath is the
 * check that cannot be bypassed.
 */

/** Everything in here is per-user. Never prerendered, never shared-cached. */
export const dynamic = "force-dynamic";

/** Signed-in pages have no business in a search index. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireUser();

  // Nobody reaches the student app before finishing onboarding. Same three
  // layers again: the proxy redirects first, this catches anything that got
  // past it, and the database refuses a second write regardless. Admins are
  // exempt — see `requireOnboarded`. Both calls below are request-cached, so
  // they share the one `getUser()` the line above already paid for.
  await requireOnboarded();

  // Admins can browse the student app freely ("view as student"); this strip
  // is their way back. Purely presentational — rendering it for a non-admin
  // would grant nothing, since /admin re-checks server-side and RLS re-checks
  // in the database.
  const isAdmin = await getIsAdmin();

  return (
    <div className="flex min-h-screen">
      {/* Renders nothing. Writes the viewer's IANA zone to a cookie so the
          Progress page and the dashboard heatmap can group dates the way the
          student reads them. Everything else stays UTC — see
          `@/lib/learn/timezone`. */}
      <TimeZoneSync />
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        {isAdmin && (
          <div className="flex items-center justify-between gap-3 border-b border-insight-hairline bg-insight-surface px-4 py-2 sm:px-8 lg:px-10">
            <p className="text-sm font-medium text-insight-dark">
              Admin account — you&apos;re viewing the student app.
            </p>
            <Link
              href="/admin"
              className="shrink-0 rounded-lg bg-insight-chip px-3 py-1 text-sm font-semibold text-insight-dark transition-colors hover:bg-insight-hairline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-insight-dark"
            >
              Back to admin
            </Link>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
