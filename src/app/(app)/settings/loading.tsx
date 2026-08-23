import { Skeleton, SkeletonPage } from "@/components/app/Skeleton";

/**
 * Settings fallback: the four stacked cards — Account, Change password, Study
 * plan, Your starting point — at the spacing `page.tsx` uses (`mt-6` for the
 * first, `mt-4` for the rest).
 */
export default function SettingsLoading() {
  return (
    <SkeletonPage className="mx-auto max-w-2xl">
      <header>
        <Skeleton className="h-9 w-40 sm:h-10" />
      </header>

      <Card className="mt-6" rows={2} />
      <Card className="mt-4" rows={2} />
      <Card className="mt-4" rows={3} subtitle />
      <Card className="mt-4" rows={3} subtitle />

      <Skeleton className="mt-6 h-11 w-32 rounded-xl" />
    </SkeletonPage>
  );
}

function Card({
  className = "",
  rows,
  subtitle = false,
}: {
  className?: string;
  rows: number;
  subtitle?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-hairline bg-surface p-6 ${className}`}
    >
      <Skeleton className="h-6 w-44" />
      {subtitle && <Skeleton className="mt-2 h-4 w-64 max-w-full" />}
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex justify-between gap-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
