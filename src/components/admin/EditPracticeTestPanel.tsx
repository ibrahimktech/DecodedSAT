"use client";

/**
 * A test's editable front matter.
 *
 * `test_type` is shown but not editable: the database has no UPDATE grant for
 * that column, because flipping full to half after questions are linked would
 * strand 22 module-2 rows and change the scoring denominator under attempts
 * already recorded. Rendering it as a read-only fact is more honest than a
 * disabled control that looks like it might work.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePracticeTestAction } from "@/app/admin/practice-tests/actions";
import type { AdminPracticeTest } from "@/lib/admin/types";
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from "@/lib/learn/types";

const FIELD_CLASS =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function EditPracticeTestPanel({ test }: { test: AdminPracticeTest }) {
  const router = useRouter();
  const [title, setTitle] = useState(test.title);
  const [description, setDescription] = useState(test.description ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(test.difficulty);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updatePracticeTestAction({
        id: test.id,
        title,
        description,
        difficulty,
      });
      if (result.status === "ok") {
        setSaved(true);
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  };

  return (
    <section
      aria-label="Test details"
      className="rounded-2xl border border-hairline bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold text-ink">Test details</h2>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={500}
            className={FIELD_CLASS}
          />
        </label>

        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Difficulty
            <select
              value={difficulty}
              onChange={(event) =>
                setDifficulty(event.target.value as Difficulty)
              }
              className={FIELD_CLASS}
            >
              {DIFFICULTIES.map((value) => (
                <option key={value} value={value}>
                  {DIFFICULTY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <p className="text-sm text-muted">
            Type:{" "}
            <strong className="text-ink">
              {test.testType === "full" ? "Full" : "Half"} (
              {test.moduleCount} module{test.moduleCount === 1 ? "" : "s"})
            </strong>
            <br />
            <span className="text-xs">
              Permanent — create a new test to change it.
            </span>
          </p>
        </div>

        {message && (
          <p
            role="alert"
            className="rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
          >
            {message}
          </p>
        )}

        {saved && (
          <p
            role="status"
            className="rounded-xl border border-accent bg-accent-chip px-4 py-3 text-sm font-medium text-accent"
          >
            Saved.
          </p>
        )}

        <div>
          <button
            type="button"
            onClick={save}
            disabled={pending || title.trim() === ""}
            className="rounded-xl bg-accent px-5 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </section>
  );
}
