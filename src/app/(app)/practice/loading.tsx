import { Skeleton, SkeletonPage } from "@/components/app/Skeleton";

/**
 * Practice hub fallback: heading, the two-tab strip, then test cards.
 *
 * This also covers `/practice/[sectionId]` and `/practice/tests/[testId]`,
 * which have no `loading.tsx` of their own — a `loading.tsx` wraps every
 * nested segment below it. The live test runner is the one place that would
 * be wrong, so it has its own; see `tests/[testId]/take/loading.tsx`.
 */
export default function PracticeLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-4xl">
      <header>
        <Skeleton className="h-9 w-44 sm:h-10" />
        <Skeleton className="mt-3 h-5 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-5 w-72 max-w-full" />
      </header>

      {/* Tab strip. The hairline is the real border, not a skeleton block —
          it is not content, so it should not pulse. */}
      <div className="mt-6 flex gap-2 border-b border-hairline">
        <Skeleton className="mb-3 h-6 w-40" />
        <Skeleton className="mb-3 h-6 w-32" />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {[0, 1].map((card) => (
          <div
            key={card}
            className="rounded-2xl border border-hairline bg-surface p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-6 w-24 rounded-lg" />
                  <Skeleton className="h-6 w-20 rounded-lg" />
                </div>
                <Skeleton className="mt-2.5 h-7 w-64 max-w-full" />
                <Skeleton className="mt-2 h-5 w-full max-w-md" />
                <Skeleton className="mt-2.5 h-4 w-56 max-w-full" />
              </div>
              <Skeleton className="h-11 w-28 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
