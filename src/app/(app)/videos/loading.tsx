import { Skeleton, SkeletonPage } from "@/components/app/Skeleton";

/**
 * Video library fallback: heading, search bar, domain chips, then a stack of
 * card outlines matching `<VideoCard />`'s split — thumbnail left, text right,
 * collapsing to stacked below `sm` exactly as the real card does.
 */
export default function VideosLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-5xl">
      <header>
        <Skeleton className="h-9 w-72 max-w-full sm:h-10" />
        <Skeleton className="mt-3 h-5 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-5 w-80 max-w-full" />
      </header>

      {/* Search bar — same box as the real GET form. */}
      <Skeleton className="mt-6 h-[3.25rem] w-full max-w-xl rounded-xl" />

      {/* Domain chips. Five is the usual row: "Everything" plus the domains. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((chip) => (
          <Skeleton key={chip} className="h-11 w-32 rounded-xl" />
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-5">
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface p-4 sm:flex-row sm:gap-6 sm:p-5"
          >
            <Skeleton className="aspect-video w-full shrink-0 self-start rounded-xl sm:w-60 md:w-72" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-7 w-3/4 sm:h-8" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-1 h-6 w-28 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
