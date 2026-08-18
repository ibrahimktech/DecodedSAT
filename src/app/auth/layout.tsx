/**
 * Shell for `/auth/*`.
 *
 * The marketing header and footer are deliberately absent — a signup page with
 * a full nav gives people places to wander off to. What stays is the mascot
 * lockup, both as a way back to the landing page and so the page still looks
 * like DecodedSAT.
 */

import Link from "next/link";
import { FoxMascot } from "@/components/FoxMascot";
import { site } from "@/lib/site";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="mb-8 flex items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <FoxMascot variant="head" className="h-12 w-auto" />
        <span className="font-display text-[1.75rem] font-extrabold tracking-tight text-ink">
          {site.name}
        </span>
      </Link>

      <main className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6 shadow-nav sm:p-8">
        {children}
      </main>
    </div>
  );
}
