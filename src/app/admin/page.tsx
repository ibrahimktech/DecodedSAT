import type { Metadata } from "next";
import Link from "next/link";
import { getAdminOverviewCounts } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * The admin landing page: four counts and the doors to the three sub-pages.
 * Deliberately thin — the work happens in /admin/questions, /admin/videos
 * and /admin/users; this page just says how much content exists.
 */
export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();

  const counts = await getAdminOverviewCounts(supabase);

  const cards = [
    {
      label: "Active questions",
      value: counts.activeQuestions,
      href: "/admin/questions",
      cta: "Manage questions",
    },
    {
      label: "Active videos",
      value: counts.activeVideos,
      href: "/admin/videos",
      cta: "Manage videos",
    },
    {
      label: "Question sets",
      value: counts.questionSets,
      href: "/admin/questions",
      cta: "Browse by set",
    },
    {
      label: "Registered users",
      value: counts.totalUsers,
      href: "/admin/users",
      cta: "View users",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-3xl font-extrabold text-ink">
        Admin overview
      </h1>
      <p className="mt-2 text-[0.9375rem] text-muted">
        Content pipeline and user list. Admin access itself is granted only in
        the database — there is nothing here (or anywhere in the app) that can
        promote a user.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="group flex flex-col gap-1 rounded-2xl border border-hairline bg-surface p-5 transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="font-display text-4xl font-extrabold text-ink">
              {card.value}
            </span>
            <span className="text-[0.9375rem] font-medium text-muted">
              {card.label}
            </span>
            <span className="mt-3 text-sm font-semibold text-accent transition-colors group-hover:text-accent-hover">
              {card.cta} →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
