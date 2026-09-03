import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MathText } from "@/components/app/MathText";
import { QuestionReportReviewActions } from "@/components/admin/QuestionReportReviewActions";
import { QuestionReportStatusBadge } from "@/components/admin/QuestionReportStatusBadge";
import {
  getAdminQuestionReport,
  listOtherOpenQuestionReports,
} from "@/lib/admin/data";
import type { AdminQuestionReportSummary } from "@/lib/admin/types";
import { requireAdmin } from "@/lib/auth/admin";
import {
  CHOICE_LETTERS,
  DIFFICULTY_LABELS,
  QUESTION_REPORT_REASON_LABELS,
} from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Review Question Report",
};

export default async function QuestionReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { supabase } = await requireAdmin();
  const parsedId = z.uuid().safeParse((await params).reportId);
  if (!parsedId.success) notFound();

  const report = await getAdminQuestionReport(supabase, parsedId.data);
  if (!report) notFound();

  const otherOpenReports = await listOtherOpenQuestionReports(
    supabase,
    report.questionId,
    report.id,
  );

  const returnTo = `/admin/question-reports/${report.id}`;
  const editParams = new URLSearchParams({
    id: report.questionId,
    edit: report.questionId,
    status: "all",
    returnTo,
  });
  const questionChanged =
    report.snapshot.prompt !== report.currentQuestion.prompt ||
    report.snapshot.correctChoice !== report.currentQuestion.correctChoice ||
    JSON.stringify(report.snapshot.choices) !==
      JSON.stringify(report.currentQuestion.choices);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/question-reports"
            className="text-sm font-semibold text-accent hover:text-accent-hover"
          >
            ← Question Reports
          </Link>
          <h1 className="mt-3 font-display text-3xl font-extrabold text-ink">
            Review question report
          </h1>
        </div>
        <QuestionReportStatusBadge status={report.status} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-hairline bg-surface p-5">
            <h2 className="font-display text-xl font-bold text-ink">
              Report information
            </h2>
            <dl className="mt-4 grid gap-4 text-[0.9375rem] sm:grid-cols-2">
              <Info label="Reason">
                {QUESTION_REPORT_REASON_LABELS[report.reason]}
              </Info>
              <Info label="Submitted">
                <time dateTime={report.createdAt}>
                  {formatDate(report.createdAt)}
                </time>
              </Info>
              <Info label="Reporter">
                {report.reporterName ?? "Student"}
                {report.reporterEmail && (
                  <span className="block text-sm text-muted">
                    {report.reporterEmail}
                  </span>
                )}
              </Info>
              <Info label="Question ID">
                <code className="break-all text-xs text-muted">
                  {report.questionId}
                </code>
              </Info>
            </dl>

            <div className="mt-4 border-t border-hairline pt-4">
              <h3 className="text-sm font-semibold text-muted">
                Student&apos;s additional details
              </h3>
              <p className="mt-1.5 whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
                {report.details ?? "No additional details provided."}
              </p>
            </div>

            {report.reviewedAt && (
              <p className="mt-4 border-t border-hairline pt-3 text-xs text-muted">
                Last reviewed {formatDate(report.reviewedAt)}
                {report.reviewerName ? ` by ${report.reviewerName}` : ""}.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">
                  Current question
                </h2>
                <p className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-muted">
                  <span>{report.currentQuestion.domainName}</span>
                  <span aria-hidden>·</span>
                  <span>{report.currentQuestion.subtopicName}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {DIFFICULTY_LABELS[report.currentQuestion.difficulty]}
                  </span>
                  {!report.currentQuestion.isActive && (
                    <span className="text-miss-ink">Inactive</span>
                  )}
                </p>
              </div>
              <Link
                href={`/admin/questions?${editParams.toString()}#question-${report.questionId}`}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Edit question
              </Link>
            </div>

            <QuestionContent
              prompt={report.currentQuestion.prompt}
              choices={report.currentQuestion.choices}
              correctChoice={report.currentQuestion.correctChoice}
              explanation={report.currentQuestion.explanation}
            />

            <p className="mt-4 border-t border-hairline pt-3 text-xs text-muted">
              {report.currentQuestion.setName && (
                <span>{report.currentQuestion.setName} · </span>
              )}
              {report.currentQuestion.externalId ?? report.questionId}
            </p>
          </section>

          <section className="rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-bold text-ink">
                Reported version
              </h2>
              <span
                className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${
                  questionChanged
                    ? "bg-insight-chip text-insight-dark"
                    : "bg-background text-muted"
                }`}
              >
                {questionChanged
                  ? "Different from current question"
                  : "Matches current question"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              Snapshot saved when the student submitted the report.
            </p>
            <QuestionContent
              prompt={report.snapshot.prompt}
              choices={report.snapshot.choices}
              correctChoice={report.snapshot.correctChoice}
            />
          </section>

          {otherOpenReports.length > 0 && (
            <section className="rounded-2xl border border-insight-hairline bg-insight-surface p-5">
              <h2 className="font-display text-xl font-bold text-insight-dark">
                {otherOpenReports.length} other open report
                {otherOpenReports.length === 1 ? "" : "s"} for this question
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {otherOpenReports.map((other) => (
                  <OtherReport key={other.id} report={other} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <QuestionReportReviewActions
            reportId={report.id}
            status={report.status}
            initialAdminNote={report.adminNote}
          />
        </div>
      </div>
    </div>
  );
}

function QuestionContent({
  prompt,
  choices,
  correctChoice,
  explanation,
}: {
  prompt: string;
  choices: string[];
  correctChoice: number;
  explanation?: string;
}) {
  return (
    <div className="mt-5">
      <MathText
        as="p"
        text={prompt}
        className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink"
      />
      <ol className="mt-4 flex flex-col gap-2">
        {choices.map((choice, index) => (
          <li
            key={index}
            className={`flex gap-3 rounded-xl border px-3 py-2.5 text-[0.9375rem] ${
              index === correctChoice
                ? "border-accent bg-accent-chip text-ink"
                : "border-hairline text-muted"
            }`}
          >
            <span className="shrink-0 font-display font-bold">
              {CHOICE_LETTERS[index]}
            </span>
            <MathText text={choice} />
            {index === correctChoice && (
              <span className="ml-auto shrink-0 text-xs font-bold text-accent">
                Correct
              </span>
            )}
          </li>
        ))}
      </ol>
      {explanation && (
        <div className="mt-4 rounded-xl bg-background p-4">
          <h3 className="text-sm font-semibold text-muted">Explanation</h3>
          <MathText
            as="p"
            text={explanation}
            className="mt-1.5 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink"
          />
        </div>
      )}
    </div>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="mt-1 text-ink">{children}</dd>
    </div>
  );
}

function OtherReport({ report }: { report: AdminQuestionReportSummary }) {
  return (
    <li>
      <Link
        href={`/admin/question-reports/${report.id}`}
        className="block rounded-xl border border-insight-hairline bg-surface px-4 py-3 transition-colors hover:border-insight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-insight-dark"
      >
        <span className="text-sm font-semibold text-ink">
          {QUESTION_REPORT_REASON_LABELS[report.reason]}
        </span>
        <span className="mt-1 block text-xs text-muted">
          {report.reporterName ?? report.reporterEmail ?? "Student"} ·{" "}
          {formatDate(report.createdAt)}
        </span>
      </Link>
    </li>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
