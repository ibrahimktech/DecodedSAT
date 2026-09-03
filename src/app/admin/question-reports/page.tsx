import type { Metadata } from "next";
import Link from "next/link";
import { MathText } from "@/components/app/MathText";
import { QuestionReportStatusBadge } from "@/components/admin/QuestionReportStatusBadge";
import {
  getQuestionReportCounts,
  listAdminQuestionReports,
} from "@/lib/admin/data";
import {
  AdminQuestionReportFiltersSchema,
  type AdminQuestionReportFilters,
} from "@/lib/admin/schemas";
import type { AdminQuestionReportSummary } from "@/lib/admin/types";
import { requireAdmin } from "@/lib/auth/admin";
import {
  QUESTION_REPORT_REASON_LABELS,
} from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Question Reports",
};

export default async function AdminQuestionReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const single = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;

  const filters = AdminQuestionReportFiltersSchema.parse({
    status: single("status"),
    reason: single("reason"),
    q: single("q"),
  });

  const [counts, reports] = await Promise.all([
    getQuestionReportCounts(supabase),
    listAdminQuestionReports(supabase, filters),
  ]);
  const status = filters.status ?? "open";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">
            Question Reports
          </h1>
          <p className="mt-2 text-[0.9375rem] text-muted">
            <strong className="text-ink">{counts.openReports}</strong> open
            report{counts.openReports === 1 ? "" : "s"} across{" "}
            <strong className="text-ink">{counts.uniqueOpenQuestions}</strong>{" "}
            question{counts.uniqueOpenQuestions === 1 ? "" : "s"}.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm font-semibold text-accent hover:text-accent-hover"
        >
          ← Overview
        </Link>
      </div>

      <ReportFilters filters={filters} status={status} />

      <section aria-label="Question report queue" className="mt-6">
        <p className="mb-3 text-sm text-muted">
          {reports.length === 200
            ? "Showing the first 200 reports — narrow the filters to see the rest."
            : `${reports.length} report${reports.length === 1 ? "" : "s"}`}
        </p>

        {reports.length === 0 ? (
          <div className="rounded-2xl border border-hairline bg-surface px-6 py-12 text-center">
            <h2 className="font-display text-xl font-bold text-ink">
              {status === "open" && !filters.reason && !filters.q
                ? "No open question reports"
                : "No reports match these filters"}
            </h2>
            <p className="mt-2 text-[0.9375rem] text-muted">
              {status === "open" && !filters.reason && !filters.q
                ? "Everything looks good for now."
                : "Try another status, reason, or search."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReportFilters({
  filters,
  status,
}: {
  filters: AdminQuestionReportFilters;
  status: NonNullable<AdminQuestionReportFilters["status"]>;
}) {
  return (
    <section aria-label="Filters" className="mt-8">
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-surface p-4"
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Status
          <select
            name="status"
            defaultValue={status}
            className={filterFieldClassName}
          >
            <option value="open">Open</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Reason
          <select
            name="reason"
            defaultValue={filters.reason ?? ""}
            className={filterFieldClassName}
          >
            <option value="">All reasons</option>
            <option value="incorrect">
              {QUESTION_REPORT_REASON_LABELS.incorrect}
            </option>
            <option value="unclear_or_broken">
              {QUESTION_REPORT_REASON_LABELS.unclear_or_broken}
            </option>
          </select>
        </label>

        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium text-muted">
          Search question text or exact ID
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            maxLength={120}
            placeholder="Question text or UUID"
            className={filterFieldClassName}
          />
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-xl bg-accent px-4 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Apply
          </button>
          <Link
            href="/admin/question-reports"
            className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-background hover:text-ink"
          >
            Clear
          </Link>
        </div>
      </form>
    </section>
  );
}

function ReportRow({ report }: { report: AdminQuestionReportSummary }) {
  return (
    <li className="rounded-2xl border border-hairline bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <QuestionReportStatusBadge status={report.status} />
            <span className="rounded-lg bg-background px-2 py-0.5 text-xs font-semibold text-muted">
              {QUESTION_REPORT_REASON_LABELS[report.reason]}
            </span>
            {report.questionReportCount > 1 && (
              <span className="rounded-lg bg-insight-chip px-2 py-0.5 text-xs font-semibold text-insight-dark">
                {report.questionReportCount} reports for this question
              </span>
            )}
          </div>

          <MathText
            as="p"
            text={report.currentPrompt}
            className="mt-3 line-clamp-3 whitespace-pre-line text-[0.9375rem] font-medium leading-relaxed text-ink"
          />

          {report.details && (
            <blockquote className="mt-3 border-l-2 border-hairline pl-3 text-sm leading-relaxed text-muted">
              {report.details}
            </blockquote>
          )}

          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>{reporterLabel(report)}</span>
            <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
            <span
              className="font-mono"
              title={`Question ID: ${report.questionId}`}
            >
              {report.externalId ?? shortId(report.questionId)}
            </span>
            {!report.currentIsActive && (
              <span className="font-semibold text-miss-ink">
                Question inactive
              </span>
            )}
          </p>
        </div>

        <Link
          href={`/admin/question-reports/${report.id}`}
          className="shrink-0 rounded-xl border border-accent px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Review
        </Link>
      </div>
    </li>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function reporterLabel(report: {
  reporterName: string | null;
  reporterEmail: string | null;
}): string {
  return report.reporterName ?? report.reporterEmail ?? "Student";
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

const filterFieldClassName =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
