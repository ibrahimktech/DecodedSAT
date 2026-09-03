"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { submitQuestionReportAction } from "@/app/question-reports/actions";
import { MathText } from "@/components/app/MathText";
import { examButtonClassName } from "@/components/app/exam/ExamShell";
import {
  CHOICE_LETTERS,
  QUESTION_REPORT_REASON_LABELS,
  type QuestionReportReason,
} from "@/lib/learn/types";

export type ReportableQuestion = {
  id: string;
  prompt: string;
  choices: string[];
};

type ReportQuestionButtonProps = {
  question: ReportableQuestion;
  questionLabel: string;
  /** Called once, immediately after the server confirms the report. */
  onReported: () => void;
  disabled?: boolean;
};

type DialogPhase = "form" | "success";

const REASONS: Array<{
  value: QuestionReportReason;
  description: string;
}> = [
  {
    value: "incorrect",
    description:
      "Wrong answer, incorrect choices, invalid solution, or a mathematical error.",
  },
  {
    value: "unclear_or_broken",
    description:
      "Confusing wording, missing information, formatting, LaTeX, image, graph, table, or duplicated content.",
  },
];

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function ReportQuestionButton({
  question,
  questionLabel,
  onReported,
  disabled = false,
}: ReportQuestionButtonProps) {
  const titleId = useId();
  const errorId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const processingRef = useRef(false);
  const advancedRef = useRef(false);
  const mountedRef = useRef(true);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<DialogPhase>("form");
  const [reportedQuestion, setReportedQuestion] =
    useState<ReportableQuestion | null>(null);
  const [reportedLabel, setReportedLabel] = useState("");
  const [requestId, setRequestId] = useState("");
  const [reason, setReason] = useState<QuestionReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const close = useCallback(() => {
    if (processingRef.current) return;
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  function showDialog() {
    if (disabled) return;

    // Copy the visible question now. Parent navigation after submission can
    // change the props while the success state remains open underneath it.
    setReportedQuestion({
      id: question.id,
      prompt: question.prompt,
      choices: [...question.choices],
    });
    setReportedLabel(questionLabel);
    setRequestId(crypto.randomUUID());
    setReason(null);
    setDetails("");
    setError(null);
    setSubmitting(false);
    setPhase("form");
    processingRef.current = false;
    advancedRef.current = false;
    setOpen(true);
  }

  // Modal keyboard behavior, focus containment, and scroll locking. The
  // original trigger receives focus again when the dialog closes.
  useEffect(() => {
    if (!open) return;

    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => panelRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panelRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
    };
  }, [close, open, phase]);

  useEffect(() => {
    if (!open || phase !== "success") return;
    const timer = window.setTimeout(close, 3_000);
    return () => window.clearTimeout(timer);
  }, [close, open, phase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !reportedQuestion ||
      !reason ||
      !requestId ||
      processingRef.current
    ) {
      if (!reason) setError("Select what seems wrong before submitting.");
      return;
    }

    processingRef.current = true;
    setSubmitting(true);
    setError(null);

    const result = await submitQuestionReportAction({
      requestId,
      questionId: reportedQuestion.id,
      reason,
      details,
    });

    if (!mountedRef.current) return;

    if (result.status !== "ok") {
      processingRef.current = false;
      setSubmitting(false);
      setError(result.message);
      return;
    }

    setSubmitting(false);
    setPhase("success");
    processingRef.current = false;

    // Advancing belongs to each runner because only it knows its established
    // navigation semantics. The success timer closes only this dialog.
    if (!advancedRef.current) {
      advancedRef.current = true;
      onReported();
    }
  }

  function stopEnterSubmittingTextarea(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    // A multiline field should always keep Enter as text. Explicitly stopping
    // propagation also prevents exam-level keyboard handlers added later from
    // treating it as an answer/navigation shortcut.
    if (event.key === "Enter") event.stopPropagation();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={showDialog}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-background hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FlagIcon className="h-4 w-4" />
        Report question
      </button>

      {open && reportedQuestion && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-ink/40 p-0 sm:items-center sm:p-4"
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={error ? errorId : undefined}
            tabIndex={-1}
            className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-2xl border border-hairline bg-surface p-5 shadow-nav outline-none sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:rounded-2xl sm:p-6"
          >
            {phase === "success" ? (
              <div className="py-4 text-center" role="status">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-chip text-accent">
                  <CheckIcon className="h-7 w-7" />
                </span>
                <h2
                  id={titleId}
                  className="mt-4 font-display text-2xl font-bold text-ink"
                >
                  Report submitted
                </h2>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
                  Thanks for letting us know. We&apos;ll review this question.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className={`${examButtonClassName("primary")} mt-6`}
                >
                  Continue
                </button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2
                      id={titleId}
                      className="font-display text-2xl font-bold text-ink"
                    >
                      Report this question
                    </h2>
                    <p className="mt-1 text-sm text-muted">{reportedLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    disabled={submitting}
                    aria-label="Close report dialog"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
                  >
                    <CloseIcon className="h-5 w-5" />
                  </button>
                </div>

                <section
                  aria-label="Question preview"
                  className="mt-5 max-h-56 overflow-y-auto rounded-xl border border-hairline bg-background p-4"
                >
                  <MathText
                    as="p"
                    text={reportedQuestion.prompt}
                    className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink"
                  />
                  <ol className="mt-3 flex flex-col gap-1.5">
                    {reportedQuestion.choices.map((choice, index) => (
                      <li
                        key={index}
                        className="flex gap-2 text-sm leading-relaxed text-muted"
                      >
                        <span className="shrink-0 font-display font-bold text-ink">
                          {CHOICE_LETTERS[index]}
                        </span>
                        <MathText text={choice} />
                      </li>
                    ))}
                  </ol>
                </section>

                <fieldset className="mt-5">
                  <legend className="font-display text-lg font-bold text-ink">
                    What seems wrong?
                  </legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {REASONS.map((item) => (
                      <label
                        key={item.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                          reason === item.value
                            ? "border-accent bg-accent-chip"
                            : "border-hairline hover:border-accent"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`report-reason-${titleId}`}
                          value={item.value}
                          checked={reason === item.value}
                          disabled={submitting}
                          onChange={() => {
                            setReason(item.value);
                            setError(null);
                          }}
                          className="mt-1 accent-accent"
                        />
                        <span>
                          <span className="block text-[0.9375rem] font-semibold text-ink">
                            {QUESTION_REPORT_REASON_LABELS[item.value]}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                            {item.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="mt-5 block">
                  <span className="font-display text-lg font-bold text-ink">
                    Additional details
                  </span>
                  <textarea
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    onKeyDown={stopEnterSubmittingTextarea}
                    maxLength={1000}
                    rows={4}
                    disabled={submitting}
                    placeholder="Tell us what seems wrong with this question..."
                    className="mt-2 min-h-28 w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60"
                  />
                  <span className="mt-1 block text-right text-xs tabular-nums text-muted">
                    {details.length}/1000
                  </span>
                </label>

                {error && (
                  <p
                    id={errorId}
                    role="alert"
                    className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2 text-sm text-miss-ink"
                  >
                    {error}
                  </p>
                )}

                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={close}
                    disabled={submitting}
                    className={examButtonClassName("secondary")}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || reason === null}
                    className={examButtonClassName("primary")}
                  >
                    {submitting ? "Submitting..." : "Submit report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 21V4" />
      <path d="M5 5h10l-1.5 3L15 11H5" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
