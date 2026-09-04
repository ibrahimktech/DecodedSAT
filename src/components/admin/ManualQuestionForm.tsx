"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createQuestionAction } from "@/app/admin/questions/actions";
import {
  QuestionFormFields,
  type QuestionDraft,
  type QuestionFieldErrors,
} from "@/components/admin/QuestionFormFields";
import { CreateQuestionSchema } from "@/lib/admin/schemas";
import type { AdminVideoOption, QuestionSetOption } from "@/lib/admin/types";
import type { Domain, Subtopic } from "@/lib/learn/types";

const FIELD_CLASS =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

function issueMap(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): QuestionFieldErrors {
  const errors: QuestionFieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (key && errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

export function ManualQuestionForm({
  domains,
  subtopics,
  questionSets,
  videos,
}: {
  domains: Domain[];
  subtopics: Subtopic[];
  questionSets: QuestionSetOption[];
  videos: AdminVideoOption[];
}) {
  const router = useRouter();
  const firstDomain = domains[0]?.id ?? "";
  const [draft, setDraft] = useState<QuestionDraft>({
    prompt: "",
    choices: ["", "", "", ""],
    correctChoice: -1,
    explanation: "",
    difficulty: "medium",
    domainId: firstDomain,
    subtopicId:
      subtopics.find((subtopic) => subtopic.domainId === firstDomain)?.id ?? "",
    solutionVideoId: null,
  });
  const [questionSetId, setQuestionSetId] = useState("");
  const [externalId, setExternalId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<QuestionFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setMessage(null);

    const input = {
      subtopicId: draft.subtopicId,
      prompt: draft.prompt,
      choices: draft.choices,
      correctChoice: draft.correctChoice,
      explanation: draft.explanation,
      difficulty: draft.difficulty,
      solutionVideoId: draft.solutionVideoId,
      questionSetId,
      externalId,
      isActive,
    };
    const parsed = CreateQuestionSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(issueMap(parsed.error.issues));
      setMessage("Check the highlighted fields and try again.");
      return;
    }

    setErrors({});
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const result = await createQuestionAction(input);
        if (result.status === "ok") {
          const status = isActive ? "active" : "inactive";
          router.push(
            `/admin/questions?id=${encodeURIComponent(result.id)}&status=${status}&created=1`,
          );
          return;
        }
        submittingRef.current = false;
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message);
      } catch {
        submittingRef.current = false;
        setMessage(
          "The question could not be created. Check your connection and try again.",
        );
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-6 rounded-2xl border border-hairline bg-surface p-5 sm:p-6"
    >
      <QuestionFormFields
        idPrefix="create-question"
        value={draft}
        onChange={(value) => {
          setMessage(null);
          setDraft(value);
          setErrors((current) => {
            const next = { ...current };
            if (value.prompt !== draft.prompt) delete next.prompt;
            if (value.explanation !== draft.explanation) delete next.explanation;
            if (value.subtopicId !== draft.subtopicId) delete next.subtopicId;
            if (value.correctChoice !== draft.correctChoice) {
              delete next.correctChoice;
            }
            if (value.solutionVideoId !== draft.solutionVideoId) {
              delete next.solutionVideoId;
            }
            value.choices.forEach((choice, index) => {
              if (choice !== draft.choices[index]) {
                delete next.choices;
                delete next[`choices.${index}`];
              }
            });
            return next;
          });
        }}
        domains={domains}
        subtopics={subtopics}
        videos={videos}
        errors={errors}
      />

      <section className="grid gap-4 border-b border-hairline py-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.72fr)] lg:gap-6">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">
            Additional metadata
          </h2>
          <p className="mt-1 text-sm text-muted">
            Question-set identity is optional. If you use it, both values are
            required so imports can continue to detect duplicates correctly.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Question set (optional)
              <select
                value={questionSetId}
                onChange={(event) => {
                  const nextQuestionSetId = event.target.value;
                  setMessage(null);
                  setQuestionSetId(nextQuestionSetId);
                  if (nextQuestionSetId === "") setExternalId("");
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.questionSetId;
                    return next;
                  });
                }}
                aria-invalid={Boolean(errors.questionSetId)}
                aria-describedby={
                  errors.questionSetId ? "create-question-set-error" : undefined
                }
                className={FIELD_CLASS}
              >
                <option value="">No question set</option>
                {questionSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
              {errors.questionSetId && (
                <span
                  id="create-question-set-error"
                  className="text-sm font-medium text-miss-ink"
                >
                  {errors.questionSetId}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              External ID {questionSetId ? "" : "(optional)"}
              <input
                type="text"
                value={externalId}
                onChange={(event) => {
                  setMessage(null);
                  setExternalId(event.target.value);
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.externalId;
                    return next;
                  });
                }}
                maxLength={64}
                required={questionSetId !== ""}
                disabled={questionSetId === ""}
                aria-invalid={Boolean(errors.externalId)}
                aria-describedby={
                  errors.externalId ? "create-question-external-error" : undefined
                }
                placeholder={questionSetId ? "e.g. practice-4-m1-q12" : "Choose a set first"}
                className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:bg-background disabled:opacity-70`}
              />
              {errors.externalId && (
                <span
                  id="create-question-external-error"
                  className="text-sm font-medium text-miss-ink"
                >
                  {errors.externalId}
                </span>
              )}
            </label>
          </div>
        </div>

        <div className="self-start rounded-xl border border-hairline bg-background p-4">
          <label className="flex items-start gap-3 text-[0.9375rem] text-ink">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => {
                setMessage(null);
                setIsActive(event.target.checked);
              }}
              className="mt-1 accent-accent"
            />
            <span>
              <strong className="block font-semibold">Active</strong>
              <span className="mt-0.5 block text-sm text-muted">
                Available in the student question bank immediately. Clear this
                to save it as a draft-like inactive question.
              </span>
            </span>
          </label>
        </div>
      </section>

      {message && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/admin/questions"
          className="rounded-xl border border-hairline px-5 py-2.5 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-background hover:text-ink"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending || draft.subtopicId === ""}
          className="rounded-xl bg-accent px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {pending ? "Creating…" : "Create Question"}
        </button>
      </div>
    </form>
  );
}
