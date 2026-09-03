import {
  QUESTION_REPORT_STATUS_LABELS,
  type QuestionReportStatus,
} from "@/lib/admin/types";

export function QuestionReportStatusBadge({
  status,
}: {
  status: QuestionReportStatus;
}) {
  const className =
    status === "open"
      ? "bg-insight-chip text-insight-dark"
      : status === "resolved"
        ? "bg-accent-chip text-accent"
        : "bg-background text-muted";

  return (
    <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${className}`}>
      {QUESTION_REPORT_STATUS_LABELS[status]}
    </span>
  );
}
