import { Skeleton, SkeletonPage } from "@/components/app/Skeleton";

/**
 * Question bank fallback, shaped like the topic picker at `/questions`.
 *
 * That is the arrival most navigations make; the player is a separate route
 * (`/questions/practice`) with its own exam-shaped fallback.
 *
 * The row rhythm matters more than the exact counts here — the real list is
 * grouped by domain and this stands in for two of those groups, so the page
 * does not visibly reflow when the counts and accuracies arrive.
 */
export default function QuestionsLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      <header>
        <Skeleton className="h-9 w-64 max-w-full sm:h-10" />
        <Skeleton className="mt-3 h-5 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-5 w-72 max-w-full" />
      </header>

      {/* Difficulty and order controls. Widths are written out rather than
          interpolated — Tailwind scans source text, so a computed class name
          is a class that never gets generated. */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-20 rounded-xl" />
        <Skeleton className="h-9 w-14 rounded-xl" />
        <Skeleton className="h-9 w-16 rounded-xl" />
        <Skeleton className="h-9 w-20 rounded-xl" />
        <Skeleton className="h-9 w-16 rounded-xl" />
        <Skeleton className="h-9 w-20 rounded-xl" />
      </div>

      {/* Practice everything. */}
      <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-hairline bg-surface p-5">
        <div className="flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-5 w-64 max-w-full" />
        </div>
        <Skeleton className="h-12 w-36 rounded-xl" />
      </div>

      {/* Topic table: a header row, then two domain groups. */}
      <div className="mt-8 flex items-center gap-4 border-b border-hairline pb-2">
        <Skeleton className="h-5 w-16 flex-1" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
      </div>

      {[0, 1].map((group) => (
        <div key={group} className="mt-6">
          <Skeleton className="h-6 w-40" />
          <div className="mt-3 flex flex-col gap-3">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="flex items-center gap-4 px-2">
                <Skeleton className="h-4 w-4 shrink-0 rounded" />
                <Skeleton className="h-5 flex-1" />
                <Skeleton className="hidden h-1.5 w-24 sm:block" />
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-5 w-12" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonPage>
  );
}
