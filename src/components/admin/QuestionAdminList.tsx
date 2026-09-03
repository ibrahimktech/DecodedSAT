"use client";

/**
 * The admin question list with inline editing and soft delete/restore.
 *
 * Each row expands in place into the edit form — no separate edit page. All
 * writes go through the Server Actions (which re-check admin status and
 * re-validate with Zod); this component's only jobs are local form state and
 * `router.refresh()` once a write lands, so the server-rendered list stays
 * the single source of truth.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setQuestionActiveAction,
  updateQuestionAction,
} from "@/app/admin/questions/actions";
import {
  QuestionFormFields,
  type QuestionDraft,
} from "@/components/admin/QuestionFormFields";
import { MathText } from "@/components/app/MathText";
import type { AdminQuestion } from "@/lib/admin/types";
import type { Domain, Subtopic } from "@/lib/learn/types";
import {
  DIFFICULTY_LABELS,
} from "@/lib/learn/types";

type Props = {
  questions: AdminQuestion[];
  domains: Domain[];
  subtopics: Subtopic[];
  initialEditingId?: string;
  returnTo?: string;
};

export function QuestionAdminList({
  questions,
  domains,
  subtopics,
  initialEditingId,
  returnTo,
}: Props) {
  if (questions.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface px-6 py-10 text-center text-[0.9375rem] text-muted">
        No questions match these filters. Add a question, upload a set above,
        or clear the filters.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {questions.map((question) => (
        <QuestionRow
          key={question.id}
          question={question}
          domains={domains}
          subtopics={subtopics}
          initiallyEditing={question.id === initialEditingId}
          returnTo={returnTo}
        />
      ))}
    </ul>
  );
}

function QuestionRow({
  question,
  domains,
  subtopics,
  initiallyEditing,
  returnTo,
}: {
  question: AdminQuestion;
  domains: Domain[];
  subtopics: Subtopic[];
  initiallyEditing: boolean;
  returnTo?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(initiallyEditing);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleActive = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setQuestionActiveAction({
        id: question.id,
        active: !question.isActive,
      });
      if (result.status === "ok") {
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  };

  return (
    <li
      id={`question-${question.id}`}
      className={`rounded-2xl border bg-surface p-4 ${
        question.isActive ? "border-hairline" : "border-miss-hairline"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Typeset, so the admin sees what the student will see. The edit
              form below deliberately does NOT — a textarea has to show the raw
              `$...$` source, or the maths becomes uneditable. */}
          <MathText
            as="p"
            text={question.prompt}
            className="font-question whitespace-pre-wrap text-base font-medium leading-7 text-ink"
          />
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-lg bg-accent-chip px-2 py-0.5 text-accent">
              {question.domainName} · {question.subtopicName}
            </span>
            <span className="rounded-lg bg-background px-2 py-0.5 text-muted">
              {DIFFICULTY_LABELS[question.difficulty]}
            </span>
            {question.setName && (
              <span className="rounded-lg bg-background px-2 py-0.5 text-muted">
                {question.setName}
              </span>
            )}
            {question.externalId && (
              <span className="rounded-lg bg-background px-2 py-0.5 font-mono text-muted">
                {question.externalId}
              </span>
            )}
            {!question.isActive && (
              <span className="rounded-lg bg-miss-surface px-2 py-0.5 text-miss-ink">
                Inactive
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setEditing((current) => !current);
            }}
            className="rounded-xl border border-hairline px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-background"
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={pending}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              question.isActive
                ? "border border-miss-hairline text-miss-ink hover:bg-miss-surface"
                : "border border-accent text-accent hover:bg-accent-chip"
            }`}
          >
            {question.isActive ? "Deactivate" : "Restore"}
          </button>
        </div>
      </div>

      {message && !editing && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}

      {editing && (
        <QuestionEditForm
          question={question}
          domains={domains}
          subtopics={subtopics}
          onSaved={() => {
            setEditing(false);
            if (returnTo) {
              router.push(returnTo);
            } else {
              router.refresh();
            }
          }}
        />
      )}
    </li>
  );
}

function QuestionEditForm({
  question,
  domains,
  subtopics,
  onSaved,
}: {
  question: AdminQuestion;
  domains: Domain[];
  subtopics: Subtopic[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<QuestionDraft>({
    prompt: question.prompt,
    choices: [...question.choices],
    correctChoice: question.correctChoice,
    explanation: question.explanation,
    difficulty: question.difficulty,
    domainId: question.domainId,
    subtopicId: question.subtopicId,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateQuestionAction({
        id: question.id,
        subtopicId: draft.subtopicId,
        prompt: draft.prompt,
        choices: draft.choices,
        correctChoice: draft.correctChoice,
        explanation: draft.explanation,
        difficulty: draft.difficulty,
      });
      if (result.status === "ok") {
        onSaved();
      } else {
        setMessage(result.message);
      }
    });
  };

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-hairline pt-4">
      <QuestionFormFields
        idPrefix={`edit-${question.id}`}
        value={draft}
        onChange={setDraft}
        domains={domains}
        subtopics={subtopics}
        compact
      />

      {message && (
        <p
          role="alert"
          className="rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={pending || draft.subtopicId === ""}
          className="rounded-xl bg-accent px-5 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
