"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  movePracticeTestQuestionAction,
  removePracticeTestQuestionAction,
} from "@/app/admin/practice-tests/actions";
import { setQuestionActiveAction } from "@/app/admin/questions/actions";
import { QuestionEditForm } from "@/components/admin/QuestionAdminList";
import { QuestionContent } from "@/components/app/QuestionContent";
import type {
  AdminPracticeTestQuestion,
  AdminVideoOption,
} from "@/lib/admin/types";
import type { Domain, Subtopic } from "@/lib/learn/types";
import { DIFFICULTY_LABELS } from "@/lib/learn/types";
import { QUESTION_TYPE_LABELS } from "@/lib/questions/answers";

export function PracticeTestQuestionManager({
  testId,
  moduleCount,
  questions,
  domains,
  subtopics,
  videos,
}: {
  testId: string;
  moduleCount: number;
  questions: AdminPracticeTestQuestion[];
  domains: Domain[];
  subtopics: Subtopic[];
  videos: AdminVideoOption[];
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl font-bold text-ink">Test questions</h2>
      <p className="mt-1 text-sm text-muted">
        Edit with the full Question Bank editor, change the order, or remove a
        question from this test without deleting it from attempt history.
      </p>

      <div className="mt-4 grid gap-6">
        {Array.from({ length: moduleCount }, (_, index) => index + 1).map(
          (moduleNumber) => {
            const moduleQuestions = questions.filter(
              (question) => question.moduleNumber === moduleNumber,
            );
            return (
              <div key={moduleNumber}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-xl font-bold text-ink">
                    Module {moduleNumber}
                  </h3>
                  <span className="text-sm font-semibold text-muted">
                    {moduleQuestions.length}/22
                  </span>
                </div>
                {moduleQuestions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-hairline bg-background px-4 py-6 text-center text-sm text-muted">
                    No questions in this module yet.
                  </p>
                ) : (
                  <ol className="flex flex-col gap-3">
                    {moduleQuestions.map((question, index) => (
                      <PracticeQuestionRow
                        key={question.id}
                        testId={testId}
                        question={question}
                        index={index}
                        count={moduleQuestions.length}
                        domains={domains}
                        subtopics={subtopics}
                        videos={videos}
                      />
                    ))}
                  </ol>
                )}
              </div>
            );
          },
        )}
      </div>
    </section>
  );
}

function PracticeQuestionRow({
  testId,
  question,
  index,
  count,
  domains,
  subtopics,
  videos,
}: {
  testId: string;
  question: AdminPracticeTestQuestion;
  index: number;
  count: number;
  domains: Domain[];
  subtopics: Subtopic[];
  videos: AdminVideoOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const move = (direction: "up" | "down") => {
    setMessage(null);
    startTransition(async () => {
      const result = await movePracticeTestQuestionAction({
        testId,
        questionId: question.id,
        direction,
      });
      if (result.status === "ok") router.refresh();
      else setMessage(result.message);
    });
  };

  const remove = () => {
    if (!window.confirm("Remove this question from the practice test?")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await removePracticeTestQuestionAction({
        testId,
        questionId: question.id,
      });
      if (result.status === "ok") router.refresh();
      else setMessage(result.message);
    });
  };

  const restore = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setQuestionActiveAction({
        id: question.id,
        active: true,
      });
      if (result.status === "ok") router.refresh();
      else setMessage(result.message);
    });
  };

  return (
    <li className="rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-chip text-sm font-bold text-accent">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <QuestionContent
            legacyText={question.prompt}
            contentBlocks={question.contentBlocks}
            textClassName="font-question text-base font-medium leading-7 text-ink"
          />
          <p className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-muted">
            <span>{question.domainName} · {question.subtopicName}</span>
            <span>{DIFFICULTY_LABELS[question.difficulty]}</span>
            <span>{QUESTION_TYPE_LABELS[question.questionType]}</span>
            {!question.isActive && <span className="text-miss-ink">Inactive</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => move("up")}
            disabled={pending || index === 0}
            aria-label={`Move question ${index + 1} up`}
            className="rounded-lg border border-hairline px-2.5 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => move("down")}
            disabled={pending || index === count - 1}
            aria-label={`Move question ${index + 1} down`}
            className="rounded-lg border border-hairline px-2.5 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="rounded-lg border border-hairline px-3 py-1.5 text-sm font-semibold text-ink"
          >
            {editing ? "Close" : "Edit"}
          </button>
          {!question.isActive && (
            <button
              type="button"
              onClick={restore}
              disabled={pending}
              className="rounded-lg border border-accent px-3 py-1.5 text-sm font-semibold text-accent disabled:opacity-40"
            >
              Restore question
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-lg border border-miss-hairline px-3 py-1.5 text-sm font-semibold text-miss-ink disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      {message && (
        <p role="alert" className="mt-3 text-sm font-medium text-miss-ink">
          {message}
        </p>
      )}

      {editing && (
        <QuestionEditForm
          question={question}
          domains={domains}
          subtopics={subtopics}
          videos={videos}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}
