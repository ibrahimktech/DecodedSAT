import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  EmptyState,
  MetricCard,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/components/admin/analytics/AnalyticsUi";
import { MathText } from "@/components/app/MathText";
import { getAnalyticsQuestion, resolveAnalyticsRange } from "@/lib/analytics/admin-data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = { title: "Question analytics" };

export default async function AnalyticsQuestionPage({ params }: { params: Promise<{ questionId: string }> }) {
  const { supabase } = await requireAdmin();
  const parsed = z.uuid().safeParse((await params).questionId);
  if (!parsed.success) notFound();
  const data = await getAnalyticsQuestion(supabase, resolveAnalyticsRange({ range: "all" }), parsed.data);
  if (!data) notFound();

  const question = data.question as Record<string, unknown>;
  const metrics = data.metrics as Record<string, unknown>;
  const distribution = (data.answerDistribution ?? []) as Record<string, unknown>[];
  const effectiveness = data.effectiveness as Record<string, unknown>;
  const choices = Array.isArray(question.choices) ? question.choices.map(String) : [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap justify-between gap-3">
        <Link href="/admin/analytics?view=questions&range=30d" className="text-sm font-semibold text-accent hover:text-accent-hover">← Back to question analytics</Link>
        <Link href="/admin/questions" className="text-sm font-semibold text-muted hover:text-accent">Open question manager →</Link>
      </div>
      <header className="mt-5"><h1 className="font-display text-3xl font-extrabold text-ink">Question {String(question.id).slice(0, 8)}</h1><p className="mt-1 text-sm capitalize text-muted">{String(question.domain)} · {String(question.subtopic)} · {String(question.difficulty)}</p></header>
      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-5"><MathText as="p" text={String(question.prompt)} className="font-question text-lg leading-7 text-ink" /></section>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Views" value={formatNumber(metrics.views)} /><MetricCard label="Attempts" value={formatNumber(metrics.attempts)} /><MetricCard label="Correct" value={formatNumber(metrics.correct)} /><MetricCard label="Incorrect" value={formatNumber(metrics.incorrect)} /><MetricCard label="Accuracy" value={formatPercent(metrics.accuracy)} /><MetricCard label="Average solve time" value={formatDuration(Number(metrics.averageAnswerTimeMs) / 1000)} /><MetricCard label="Median solve time" value={formatDuration(Number(metrics.medianAnswerTimeMs) / 1000)} /><MetricCard label="Skip rate" value={formatPercent(metrics.skipRate)} title="Question views skipped after at least 3 seconds." /><MetricCard label="Give-up rate" value={formatPercent(metrics.giveUpRate)} title="Question views left after at least 30 seconds without submission." /><MetricCard label="Struggle rate" value={formatPercent(metrics.struggleRate)} title="Long solves (2+ minutes), or incorrect answers after at least one minute." /><MetricCard label="Explanation opens" value={formatNumber(metrics.explanationOpens)} /><MetricCard label="Explanation open rate" value={formatPercent(metrics.explanationOpenRate)} /><MetricCard label="Explanation video starts" value={formatNumber(metrics.explanationVideoStarts)} /><MetricCard label="Video completion" value={formatPercent(metrics.explanationVideoCompletionRate)} /><MetricCard label="Reports" value={formatNumber(metrics.reports)} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-hairline bg-surface p-5"><h2 className="font-display text-xl font-bold text-ink">Answer-choice distribution</h2>{distribution.length === 0 ? <EmptyState text="No submitted answers yet." /> : <div className="mt-4 space-y-3">{distribution.map((row) => { const choice = Number(row.choice); const percent = Number(row.percent || 0); return <div key={choice}><div className="mb-1 flex justify-between gap-3 text-sm"><span className={row.isCorrect ? "font-bold text-accent" : "text-ink"}>{String.fromCharCode(65 + choice)}. {choices[choice] ?? ""}{row.isCorrect ? " · correct" : ""}</span><span className="font-semibold tabular-nums">{percent}% ({formatNumber(row.count)})</span></div><div className="h-2 overflow-hidden rounded-full bg-background"><div className={row.isCorrect ? "h-full bg-accent" : "h-full bg-muted/40"} style={{ width: `${Math.min(100, percent)}%` }} /></div></div>; })}</div>}</section>

        <section className="rounded-2xl border border-hairline bg-surface p-5"><h2 className="font-display text-xl font-bold text-ink">Explanation follow-through</h2><p className="mt-1 text-sm leading-relaxed text-muted">Observational comparison only. These numbers describe what students did later; they do not prove that the video caused an improvement.</p><dl className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-background p-3"><dt className="text-xs text-muted">Incorrect students who watched</dt><dd className="mt-1 font-display text-xl font-bold text-ink">{formatPercent(effectiveness.watchRate)}</dd></div><div className="rounded-xl bg-background p-3"><dt className="text-xs text-muted">Watchers who completed</dt><dd className="mt-1 font-display text-xl font-bold text-ink">{formatPercent(effectiveness.completionRate)}</dd></div><div className="rounded-xl bg-background p-3"><dt className="text-xs text-muted">Later skill accuracy · watched</dt><dd className="mt-1 font-display text-xl font-bold text-ink">{formatPercent(effectiveness.watchedLaterAccuracy)}</dd><p className="text-xs text-muted">{formatNumber(effectiveness.watchedLaterAttempts)} attempts</p></div><div className="rounded-xl bg-background p-3"><dt className="text-xs text-muted">Later skill accuracy · did not watch</dt><dd className="mt-1 font-display text-xl font-bold text-ink">{formatPercent(effectiveness.comparisonLaterAccuracy)}</dd><p className="text-xs text-muted">{formatNumber(effectiveness.comparisonLaterAttempts)} attempts</p></div><div className="col-span-2 rounded-xl bg-background p-3"><dt className="text-xs text-muted">Students who later retried this question correctly</dt><dd className="mt-1 font-display text-xl font-bold text-ink">{formatNumber(effectiveness.successfulRetries)}</dd></div></dl></section>
      </div>
    </div>
  );
}
