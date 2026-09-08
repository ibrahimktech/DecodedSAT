"use client";

/**
 * The bulk JSON upload for /admin/questions.
 *
 * Client-side checks here (extension, size, "is it even JSON") are instant
 * feedback and nothing more — the Server Action re-validates everything with
 * Zod and the database function re-validates every row again. The interesting
 * part is the summary: imported / skipped / rejected-with-reasons, rendered
 * in full after every upload, because "done" without numbers hides exactly
 * the rows that need fixing.
 */

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadQuestionSetAction } from "@/app/admin/questions/actions";
import { UPLOAD_MAX_BYTES } from "@/lib/admin/schemas";
import { initialUploadState } from "@/lib/admin/types";

export function UploadQuestionsPanel() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (previous: typeof initialUploadState, formData: FormData) => {
      const result = await uploadQuestionSetAction(previous, formData);
      // A successful import changes the list below; refresh re-runs the
      // server queries while the summary stays in this component's state.
      if (result.status === "ok") router.refresh();
      return result;
    },
    initialUploadState,
  );

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
      setLocalError("That file is over 1 MB. Split it into smaller sets.");
      setFileName(null);
      return;
    }
    setFileName(file.name);
  };

  return (
    <section
      aria-label="Upload questions"
      className="mt-8 rounded-2xl border border-hairline bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold text-ink">
        Upload a question set
      </h2>
      <p className="mt-1 text-sm text-muted">
        One .json file per set. Re-uploading the same file skips rows whose{" "}
        <code className="rounded bg-background px-1">external_id</code> already
        exists in that set.
      </p>

      <details className="mt-3 rounded-xl border border-hairline bg-background p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          JSON format and rich content
        </summary>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Existing files with <code className="rounded bg-surface px-1">prompt</code>{" "}
          still work unchanged. You may also use <code className="rounded bg-surface px-1">question_text</code>{" "}
          as its alias, or add <code className="rounded bg-surface px-1">content_blocks</code>.
          Text and table cells keep single-dollar inline LaTeX; centered equations contain raw LaTeX without dollar signs.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface p-3 text-xs leading-relaxed text-ink">
{`{
  "set_name": "Rich content examples",
  "questions": [{
    "external_id": "rich-001",
    "domain": "Algebra",
    "subtopic": "Solving linear equations",
    "prompt": "The equation below represents a relationship. What is x?",
    "content_blocks": [
      {
        "id": "c0a80101-0000-4000-8000-000000000001",
        "type": "text",
        "content": "The equation below represents a relationship between $x$ and $y$."
      },
      {
        "id": "c0a80101-0000-4000-8000-000000000002",
        "type": "centered_math",
        "content": "y = 3x^2 - 4x + 7"
      },
      {
        "id": "c0a80101-0000-4000-8000-000000000003",
        "type": "table",
        "header": true,
        "rows": [["$x$", "$f(x)$"], ["1", "4"], ["2", "7"]]
      },
      {
        "id": "c0a80101-0000-4000-8000-000000000004",
        "type": "text",
        "content": "What is the value of $y$ when $x=2$?"
      }
    ],
    "choices": [
      { "label": "A", "text": "3" },
      { "label": "B", "text": "7" },
      { "label": "C", "text": "11" },
      { "label": "D", "text": "15" }
    ],
    "correct_answer": "C",
    "explanation": "Substitute the given value and simplify.",
    "difficulty": "medium"
  }]
}`}
        </pre>
      </details>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
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
          <span className="text-sm text-muted">Up to 1 MB, 500 questions</span>
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

      {state.status === "ok" && (
        <div role="status" className="mt-4 flex flex-col gap-3">
          <p className="rounded-xl border border-accent bg-accent-chip px-4 py-3 text-sm font-medium text-accent">
            Imported {state.imported} · skipped {state.skippedDuplicates}{" "}
            duplicate{state.skippedDuplicates === 1 ? "" : "s"} · rejected{" "}
            {state.rejected.length}
          </p>

          {state.rejected.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-insight-hairline bg-insight-surface">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-insight-hairline text-insight-dark">
                    <th className="px-4 py-2 font-semibold">external_id</th>
                    <th className="px-4 py-2 font-semibold">Why it was rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rejected.map((entry, index) => (
                    <tr
                      key={`${entry.externalId}-${index}`}
                      className="border-b border-insight-hairline/50 last:border-b-0"
                    >
                      <td className="px-4 py-2 font-mono text-xs text-ink">
                        {entry.externalId}
                      </td>
                      <td className="px-4 py-2 text-ink">{entry.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
