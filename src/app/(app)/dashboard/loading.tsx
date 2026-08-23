import { Skeleton, SkeletonPage } from "@/components/app/Skeleton";

/**
 * Dashboard fallback. Mirrors `page.tsx` block for block — greeting and streak
 * chip, heatmap card, three stat cards, the "Continue" card, the mastery card
 * — so the real content drops into boxes that are already the right size and
 * nothing jumps when it swaps in.
 *
 * The container classes are copied from the page rather than approximated. If
 * the page's layout changes, this has to change with it; a skeleton that no
 * longer matches is worse than none, because it promises a shape the page then
 * contradicts.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-5xl">
      {/* --- Greeting ------------------------------------------------------ */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2.5 h-9 w-56 sm:h-10" />
        </div>
        <Skeleton className="h-10 w-36 rounded-xl" />
      </header>

      {/* --- Activity heatmap ---------------------------------------------- */}
      <div className="mt-8 rounded-2xl border border-hairline bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="mt-4 h-24 w-full" />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>

      {/* --- Stat cards ----------------------------------------------------
          Three, matching the page's grid at every breakpoint. The third card
          spans two columns at `sm` exactly as the real one does. */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard />
        <StatCard />
        <StatCard className="sm:col-span-2 lg:col-span-1" />
      </div>

      {/* --- Continue where you left off ----------------------------------- */}
      <div className="mt-6 rounded-2xl border border-hairline bg-surface p-6">
        <Skeleton className="h-6 w-56" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <Skeleton className="h-5 w-72 max-w-full" />
          <Skeleton className="h-11 w-32 rounded-xl" />
        </div>
      </div>

      {/* --- Domain mastery ------------------------------------------------
          Four rows: the SAT Math domain count, so the card lands at close to
          its final height instead of growing under the reader. */}
      <div className="mt-6 rounded-2xl border border-hairline bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {[0, 1, 2, 3].map((row) => (
            <div key={row}>
              <div className="flex items-baseline justify-between gap-2">
                <Skeleton className="h-5 w-44 max-w-[60%]" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="mt-1.5 h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

function StatCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-hairline bg-surface p-6 ${className}`}
    >
      <Skeleton className="h-5 w-28" />
      <Skeleton className="mt-3 h-12 w-24" />
      <Skeleton className="mt-2 h-4 w-40 max-w-full" />
    </div>
  );
}
