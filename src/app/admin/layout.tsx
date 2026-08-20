import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdmin } from "@/lib/auth/admin";

/**
 * KaTeX's stylesheet, imported once per surface that renders question
 * content. Next dedupes the import, so listing it in both app shells costs
 * nothing and keeps the landing page — which renders no math — from carrying
 * it. The fonts it references are resolved as bundled assets and fetched by
 * the browser only when a glyph actually needs one.
 */
import "katex/dist/katex.min.css";

/**
 * Shell for the admin panel.
 *
 * `requireAdmin()` here is the middle of the three layers: the proxy already
 * bounced non-admins as a routing convenience, this check travels with the
 * pages, and the RLS policies underneath — every one gated on the database's
 * own `is_admin()` — are the check that cannot be bypassed. A non-admin who
 * somehow rendered this layout would still read empty admin views and write
 * nothing.
 */

/** Everything in here is per-admin and freshly queried. */
export const dynamic = "force-dynamic";

/** Admin pages have even less business in a search index than student ones. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: {
    default: "Admin",
    template: "%s · DecodedSAT admin",
  },
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();

  return (
    <div className="flex min-h-screen">
      <AdminNav />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}
