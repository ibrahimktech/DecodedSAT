"use client";

/**
 * The question upload for one practice test.
 *
 * Same drag-and-drop shape as the question-set upload, and deliberately the
 * same JSON format plus one field — `module_number` — so there is one
 * authoring format to learn.
 *
 * The difference is the failure mode. A question set imports what it can and
 * lists the rows it rejected; a practice test is all-or-nothing, because a
 * test with 21 questions in module 1 is not a test. So the rejection panel
 * shows every reason the file was refused and nothing was written.
 */

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadTestQuestionsAction } from "@/app/admin/practice-tests/actions";
import { MODULE_QUESTION_COUNT, UPLOAD_MAX_BYTES } from "@/lib/admin/schemas";
import { initialTestUploadState } from "@/lib/admin/types";

export function UploadTestQuestionsPanel({
  testId,
  testType,
  hasQuestions,
}: {
  testId: string;
  testType: "full" | "half";
  hasQuestions: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (previous: typeof initialTestUploadState, formData: FormData) => {
      const result = await uploadTestQuestionsAction(previous, formData);
      if (result.status === "ok") router.refresh();
      return result;
    },
    initialTestUploadState,
  );

  const expected =
    testType === "full" ? MODULE_QUESTION_COUNT * 2 : MODULE_QUESTION_COUNT;

  /** Fast local feedback; the server remains the boundary. */
  const acceptFile = (file: File | undefined | null): void => {
    setLocalError(null);
    if (!file) {
      setFileName(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      setLocalError("Choose a .json file.");
      setFileName(null);
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setLocalError("That file is over 1 MB. A practice test should be well under.");
      setFileName(null);
      return;
    }
    setFileName(file.name);
  };

  return (
    <section
      aria-label="Upload test questions"
      className="mt-8 rounded-2xl border border-hairline bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold text-ink">
        {hasQuestions ? "Replace the questions" : "Upload the questions"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {expected} questions total —{" "}
        {testType === "full"
          ? `${MODULE_QUESTION_COUNT} with module_number 1 and ${MODULE_QUESTION_COUNT} with module_number 2`
          : `all with module_number 1`}
        . The whole file is checked before anything is written: if a module
        count is wrong, nothing imports.
      </p>

      <details className="mt-3 rounded-xl border border-hairline bg-background p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          What the file should look like
        </summary>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Same shape as a question set upload, plus{" "}
          <code className="rounded bg-surface px-1">module_number</code> on
          every question.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          <strong className="text-ink">Write maths as LaTeX</strong> between
          dollar signs — <code className="rounded bg-surface px-1">$x^{"{2}"}$</code>,{" "}
          <code className="rounded bg-surface px-1">
            {"$\\sqrt{x}$"}
          </code>{" "}
          — in prompts, choices and explanations. A literal dollar sign in a
          price is written{" "}
          <code className="rounded bg-surface px-1">{"\\$"}</code>, otherwise
          it starts a maths span and swallows the rest of the sentence.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface p-3 text-xs leading-relaxed text-ink">
{`{
  "create_new_subtopics": false,
  "questions": [
    {
      "external_id": "pt3-m1-01",
      "module_number": 1,
      "domain": "Algebra",
      "subtopic": "Linear equations in one variable",
      "prompt": "If $5x - 3 = 17$, what is the value of $x$?",
      "choices": [
        { "label": "A", "text": "2" },
        { "label": "B", "text": "3" },
        { "label": "C", "text": "4" },
        { "label": "D", "text": "7" }
      ],
      "correct_answer": "C",
      "explanation": "Add 3 to both sides: $5x = 20$, so $x = 4$.",
      "difficulty": "easy"
    }
  ]
}`}
        </pre>
      </details>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="testId" value={testId} />

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped && fileInputRef.current) {
              // Register the dropped file on the real input so the plain form
              // post carries it.
              const transfer = new DataTransfer();
              transfer.items.add(dropped);
              fileInputRef.current.files = transfer.files;
            }
            acceptFile(dropped);
          }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging
              ? "border-accent bg-accent-chip"
              : "border-hairline bg-background hover:border-accent"
          }`}
        >
          <span className="text-[0.9375rem] font-semibold text-ink">
            {fileName ?? "Drop a .json file here, or click to choose"}
          </span>
          <span className="text-sm text-muted">
            Up to 1 MB · {expected} questions expected
          </span>
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => acceptFile(event.target.files?.[0])}
          />
        </label>

        {localError && (
          <p
            role="alert"
            className="rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
          >
            {localError}
          </p>
        )}

        {hasQuestions && (
          <p className="rounded-xl border border-insight-hairline bg-insight-surface px-4 py-3 text-sm text-insight-dark">
            This test already has questions. Uploading replaces which questions
            it uses — students&apos; past attempts and scores are untouched.
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={pending || !fileName || localError !== null}
            className="rounded-xl bg-accent px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {pending ? "Importing…" : "Upload & import"}
          </button>
        </div>
      </form>

      {(state.status === "error" || state.status === "rate_limited") && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
        >
          {state.message}
        </p>
      )}

      {state.status === "rejected" && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface p-4"
        >
          <p className="text-sm font-semibold text-miss-ink">
            Nothing was imported. Fix these and upload again:
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-miss-ink">
            {state.errors.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {state.status === "ok" && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-accent bg-accent-chip px-4 py-3 text-sm font-medium text-accent"
        >
          Imported {state.imported} new question
          {state.imported === 1 ? "" : "s"}, reused {state.reused}, and linked{" "}
          {state.linked} into this test. It&apos;s live for students now.
        </p>
      )}
    </section>
  );
}
