import { Skeleton, SkeletonPage } from "@/components/app/Skeleton";

/**
 * Progress fallback: heading, then two day-groups of single-line entry rows,
 * matching the `px-5 py-3.5` rows in `page.tsx`. Two groups rather than one so
 * the page does not visibly grow when a second day arrives.
 */
export default function ProgressLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      <header>
        <Skeleton className="h-9 w-44 sm:h-10" />
        <Skeleton className="mt-3 h-5 w-full max-w-2xl" />
      </header>

      <div className="mt-8 flex flex-col gap-8">
        {[2, 3].map((rows, group) => (
          <div key={group}>
            <Skeleton className="h-6 w-40" />
            <div className="mt-3 flex flex-col gap-2">
              {Array.from({ length: rows }, (_, row) => (
                <div
                  key={row}
                  className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-5 py-3.5"
                >
                  <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
                  <Skeleton className="h-5 w-56 max-w-[45%]" />
                  <Skeleton className="h-5 w-40 max-w-[35%]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
