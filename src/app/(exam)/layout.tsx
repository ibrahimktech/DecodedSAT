import type { Metadata } from "next";
import { requireOnboarded } from "@/lib/auth/require-onboarded";
import { requireUser } from "@/lib/auth/require-user";

/**
 * KaTeX's stylesheet. Imported per surface that renders question content —
 * Next dedupes it, so listing it here as well as in the `(app)` shell costs
 * nothing and keeps the landing page free of it.
 */
import "katex/dist/katex.min.css";

/**
 * Shell for the two surfaces where a student is answering questions.
 *
 * Identical to `(app)/layout.tsx` in what it enforces and deliberately
 * different in what it renders. There is no nav rail, no admin strip, no page
 * padding: a student mid-module should see the question and the exam controls
 * and nothing else, which is how the real digital SAT works and why this is a
 * separate route group rather than a conditional inside the other one. Route
 * groups do not appear in URLs, so every path under here is unchanged and
 * `src/proxy.ts` needs no knowledge of this split.
 *
 * `requireUser()` and `requireOnboarded()` are the same three-layer story as
 * the student app: the proxy redirects first, this catches what got past it,
 * and Row Level Security underneath is the check that cannot be bypassed. Both
 * calls are request-cached, so repeating them here is free.
 *
 * `TimeZoneSync` is not mounted. It exists to write the viewer's IANA zone for
 * the Progress heatmap, and every route that needs that cookie lives under
 * `(app)`, which sets it on arrival.
 */

/** Everything here is per-user and clock-sensitive. Never cached, never shared. */
export const dynamic = "force-dynamic";

/** Signed-in pages have no business in a search index. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ExamLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireUser();
  await requireOnboarded();

  return children;
}
