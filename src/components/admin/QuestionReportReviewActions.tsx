"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateQuestionReportAction } from "@/app/admin/question-reports/actions";
import type { QuestionReportStatus } from "@/lib/admin/types";

type QuestionReportReviewActionsProps = {
  reportId: string;
  status: QuestionReportStatus;
  initialAdminNote: string | null;
};

export function QuestionReportReviewActions({
  reportId,
  status,
  initialAdminNote,
}: QuestionReportReviewActionsProps) {
  const router = useRouter();
  const [adminNote, setAdminNote] = useState(initialAdminNote ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] =
    useState<QuestionReportStatus | null>(null);
  const [pending, startTransition] = useTransition();

  function update(nextStatus: QuestionReportStatus) {
    setMessage(null);
    setPendingStatus(nextStatus);
    startTransition(async () => {
      const result = await updateQuestionReportAction({
        reportId,
        status: nextStatus,
        adminNote,
      });
      if (result.status === "ok") {
        router.refresh();
      } else {
        setMessage(result.message);
      }
      setPendingStatus(null);
    });
  }

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5">
      <h2 className="font-display text-xl font-bold text-ink">
        Review outcome
      </h2>
      <label className="mt-4 block text-sm font-medium text-muted">
        Admin note <span className="font-normal">(internal only)</span>
        <textarea
          value={adminNote}
          onChange={(event) => setAdminNote(event.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="What was checked or changed?"
          className="mt-1.5 min-h-28 w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
        <span className="mt-1 block text-right text-xs tabular-nums text-muted">
          {adminNote.length}/2000
        </span>
      </label>

      {message && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2 text-sm text-miss-ink"
        >
          {message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {status === "open" && (
          <ActionButton
            label="Mark reviewed"
            target="reviewed"
            pending={pending}
            pendingStatus={pendingStatus}
            onClick={update}
          />
        )}
        {(status === "open" || status === "reviewed") && (
          <>
            <ActionButton
              label="Mark resolved"
              target="resolved"
              pending={pending}
              pendingStatus={pendingStatus}
              onClick={update}
              primary
            />
            <ActionButton
              label="Dismiss report"
              target="dismissed"
              pending={pending}
              pendingStatus={pendingStatus}
              onClick={update}
            />
          </>
        )}
        {(status === "resolved" || status === "dismissed") && (
          <ActionButton
            label="Reopen report"
            target="open"
            pending={pending}
            pendingStatus={pendingStatus}
            onClick={update}
          />
        )}
      </div>
    </section>
  );
}

function ActionButton({
  label,
  target,
  pending,
  pendingStatus,
  onClick,
  primary = false,
}: {
  label: string;
  target: QuestionReportStatus;
  pending: boolean;
  pendingStatus: QuestionReportStatus | null;
  onClick: (status: QuestionReportStatus) => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(target)}
      disabled={pending}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "bg-accent text-white hover:bg-accent-hover"
          : "border border-hairline text-ink hover:bg-background"
      }`}
    >
      {pending && pendingStatus === target ? "Saving..." : label}
    </button>
  );
}
