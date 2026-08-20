/**
 * Shell for `/onboarding`.
 *
 * Sits outside the `(app)` route group on purpose. Two reasons, and both
 * matter:
 *
 *   1. `(app)/layout.tsx` calls `requireOnboarded()`, which redirects here.
 *      Nesting the wizard under it would make the flow redirect to itself.
 *   2. The NavRail would offer a half-registered student four places to
 *      wander off to before they have finished the one thing being asked.
 *
 * Same lockup as `/auth/*`, one size wider — the wizard holds option cards
 * rather than two text fields.
 */

import type { Metadata } from "next";
import { FoxMascot } from "@/components/FoxMascot";
import { site } from "@/lib/site";

/** Per-user, and the gate below it must never be answered from a cache. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your account",
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
      {/* Not a link home: leaving mid-flow loses the answers, and there is
          nothing on the landing page a signed-in student needs. */}
      <div className="mb-8 flex items-center gap-3">
        <FoxMascot variant="head" className="h-12 w-auto" />
        <span className="font-display text-[1.75rem] font-extrabold tracking-tight text-ink">
          {site.name}
        </span>
      </div>

      <main className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-6 shadow-nav sm:p-8">
        {children}
      </main>
    </div>
  );
}
