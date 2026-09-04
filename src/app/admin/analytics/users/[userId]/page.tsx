import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  EmptyState,
  MetricCard,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/components/admin/analytics/AnalyticsUi";
import { getAnalyticsUser, resolveAnalyticsRange } from "@/lib/analytics/admin-data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = { title: "Student analytics" };

export default async function AnalyticsUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { supabase } = await requireAdmin();
  const parsed = z.uuid().safeParse((await params).userId);
  if (!parsed.success) notFound();
  const data = await getAnalyticsUser(supabase, resolveAnalyticsRange({ range: "all" }), parsed.data);
  if (!data) notFound();

  const user = data.user as Record<string, unknown>;
  const overview = data.overview as Record<string, unknown>;
  const activity = (data.recentActivity ?? []) as Record<string, unknown>[];
  const performance = (data.performance ?? []) as Record<string, unknown>[];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/analytics?view=users&range=30d" className="text-sm font-semibold text-accent hover:text-accent-hover">← Back to student analytics</Link>
      <header className="mt-5">
        <h1 className="font-display text-3xl font-extrabold text-ink">{String(user.fullName || "Unnamed student")}</h1>
        <p className="mt-1 text-sm text-muted">{String(user.email || "No email")} · Joined {formatDate(user.joinedAt)}</p>
      </header>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Last active" value={formatDate(overview.lastActive)} />
        <MetricCard label="Sessions" value={formatNumber(overview.sessions)} />
        <MetricCard label="Practice sessions" value={formatNumber(overview.practiceSessions)} />
        <MetricCard label="Questions" value={formatNumber(overview.questionsAttempted)} />
        <MetricCard label="Accuracy" value={formatPercent(overview.accuracy)} />
        <MetricCard label="Correct" value={formatNumber(overview.questionsCorrect)} />
        <MetricCard label="Videos started" value={formatNumber(overview.videosStarted)} />
        <MetricCard label="Explanation videos" value={formatNumber(overview.explanationVideosWatched)} />
        <MetricCard label="Estimated study time" value={formatDuration(overview.estimatedStudySeconds)} />
        <MetricCard label="Average answer time" value={formatDuration(Number(overview.averageAnswerTimeMs) / 1000)} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <h2 className="font-display text-xl font-bold text-ink">Performance breakdown</h2>
          <p className="mt-1 text-sm text-muted">Weakest areas appear first. Timing is shown only where milestone data exists.</p>
          {performance.length === 0 ? <EmptyState text="No answered questions yet." /> : (
            <div className="mt-4 divide-y divide-hairline">
              {performance.map((row, index) => (
                <div key={`${String(row.domain)}-${String(row.subtopic)}-${String(row.difficulty)}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 py-3 first:pt-0">
                  <div><p className="font-semibold text-ink">{String(row.subtopic)}</p><p className="text-xs capitalize text-muted">{String(row.domain)} · {String(row.difficulty)}</p></div>
                  <div className="text-right"><p className="font-bold tabular-nums text-ink">{formatPercent(row.accuracy)}</p><p className="text-xs text-muted">{formatNumber(row.attempts)} attempts · {formatDuration(Number(row.averageAnswerTimeMs) / 1000)}</p></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <h2 className="font-display text-xl font-bold text-ink">Recent activity</h2>
          {activity.length === 0 ? <EmptyState text="No activity yet." /> : (
            <ol className="mt-4 divide-y divide-hairline">
              {activity.map((row, index) => (
                <li key={`${String(row.occurredAt)}-${index}`} className="py-3 first:pt-0">
                  <div className="flex justify-between gap-3"><p className="text-sm font-medium text-ink">{String(row.eventName).replaceAll("_", " ")}{row.correct === true ? " · correct" : row.correct === false ? " · incorrect" : ""}</p><time className="shrink-0 text-xs text-muted">{formatDate(row.occurredAt)}</time></div>
                  {Boolean(row.questionId) && <Link href={`/admin/analytics/questions/${String(row.questionId)}`} className="mt-1 inline-block text-xs font-semibold text-accent">Question {String(row.questionId).slice(0, 8)}</Link>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
