import { Skeleton, SkeletonPage } from "@/components/app/Skeleton";

/**
 * Fallback for the question bank player.
 *
 * Without it the nearest `loading.tsx` above wins — the picker's — and starting
 * a set would flash a filter screen the student has just left. Mirrors
 * `ExamShell`'s frame so the real chrome lands where the skeleton drew it.
 */
export default function QuestionsPracticeLoading() {
  return (
    <SkeletonPage className="flex min-h-screen flex-col bg-background">
      <div className="sticky top-0 border-b border-hairline bg-surface">
        <div className="mx-auto grid w-full max-w-page grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2 sm:px-5">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-11 w-24" />
          <div className="flex justify-end gap-2">
            <Skeleton className="h-11 w-20" />
            <Skeleton className="h-11 w-20" />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3 border-b border-hairline pb-3">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="ml-auto h-6 w-28" />
        </div>

        <Skeleton className="mt-5 h-6 w-full" />
        <Skeleton className="mt-2 h-6 w-5/6" />
        <Skeleton className="mt-2 h-6 w-2/3" />

        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2, 3].map((choice) => (
            <Skeleton key={choice} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-hairline bg-surface">
        <div className="mx-auto grid w-full max-w-page grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-3 sm:px-5">
          <div />
          <Skeleton className="h-10 w-44 rounded-xl" />
          <div className="flex justify-end">
            <Skeleton className="h-10 w-32 rounded-xl" />
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}
