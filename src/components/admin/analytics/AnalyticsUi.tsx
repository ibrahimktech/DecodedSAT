import Link from "next/link";
import type { AnalyticsRange } from "@/lib/analytics/admin-data";

const TABS = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["questions", "Questions"],
  ["videos", "Videos"],
  ["traffic", "Traffic"],
  ["retention", "Retention"],
  ["sessions", "Sessions"],
] as const;

export function AnalyticsTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Analytics sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-hairline">
      {TABS.map(([key, label]) => (
        <Link
          key={key}
          href={`/admin/analytics?view=${key}&range=30d`}
          aria-current={active === key ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
            active === key
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function DateRangeFilter({
  range,
  view,
}: {
  range: AnalyticsRange;
  view: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap gap-2" aria-label="Date range">
        {[
          ["today", "Today"],
          ["7d", "7 days"],
          ["30d", "30 days"],
          ["90d", "90 days"],
          ["all", "All time"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/admin/analytics?view=${encodeURIComponent(view)}&range=${key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              range.key === key
                ? "border-accent bg-accent-chip text-accent"
                : "border-hairline bg-surface text-muted hover:border-accent hover:text-ink"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="range" value="custom" />
        <label className="text-xs font-semibold text-muted">
          From
          <input
            type="date"
            name="from"
            max={today}
            defaultValue={range.customFrom}
            className="mt-1 block rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="text-xs font-semibold text-muted">
          To
          <input
            type="date"
            name="to"
            max={today}
            defaultValue={range.customTo}
            className="mt-1 block rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        </label>
        <button className="rounded-lg bg-ink px-3 py-2 text-sm font-bold text-white">Apply</button>
      </form>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4" title={title}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-ink">{value}</p>
    </div>
  );
}

export function MiniBars({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
}) {
  const shown = rows.slice(-30);
  const max = Math.max(1, ...shown.map((row) => row.value));
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5">
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      {shown.length === 0 ? (
        <EmptyState text="No activity in this period." />
      ) : (
        <div className="mt-5 flex h-36 items-end gap-1" role="img" aria-label={`${title} over time`}>
          {shown.map((row) => (
            <div key={row.label} className="group flex min-w-0 flex-1 items-end" title={`${row.label}: ${row.value}`}>
              <span
                className="w-full min-w-1 rounded-t bg-accent transition-colors group-hover:bg-accent-hover"
                style={{ height: `${Math.max(row.value > 0 ? 4 : 1, (row.value / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="mt-4 rounded-xl bg-background px-4 py-5 text-sm text-muted">{text}</p>;
}

export function DataError() {
  return (
    <div role="alert" className="mt-6 rounded-2xl border border-insight-hairline bg-insight-surface p-5 text-sm text-insight-dark">
      Analytics data is not available yet. Apply the included Supabase migration, then reload this page.
    </div>
  );
}

export function formatNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : "—";
}

export function formatPercent(value: unknown): string {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? `${number}%` : "Insufficient data";
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDuration(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

