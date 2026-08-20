"use client";

/**
 * Step 1 of building a practice test: its front matter.
 *
 * A plain form post — the action redirects to the new test's page, where the
 * questions get uploaded. Two steps rather than one because the test row has
 * to exist before 44 questions can be attached to it.
 *
 * Timing is not on this form. It is locked to the real digital SAT (35 minutes
 * per module) by `sat_module_seconds()` in the database, so there is nothing
 * to choose — the copy states the consequence of the type instead.
 */

import { useActionState } from "react";
import { createPracticeTestAction } from "@/app/admin/practice-tests/actions";
import { MODULE_QUESTION_COUNT, MODULE_SECONDS } from "@/lib/admin/schemas";
import type { AdminActionResult } from "@/lib/admin/types";
import { DIFFICULTIES, DIFFICULTY_LABELS } from "@/lib/learn/types";

const FIELD_CLASS =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

const MODULE_MINUTES = Math.round(MODULE_SECONDS / 60);

const initialState: AdminActionResult = { status: "ok" };

export function CreatePracticeTestPanel() {
  const [state, formAction, pending] = useActionState(
    async (_previous: AdminActionResult, formData: FormData) =>
      createPracticeTestAction(formData),
    initialState,
  );

  return (
    <section
      aria-label="Create a practice test"
      className="mt-8 rounded-2xl border border-hairline bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold text-ink">
        Create a practice test
      </h2>
      <p className="mt-1 text-sm text-muted">
        Timing is fixed to the real digital SAT: {MODULE_MINUTES} minutes for{" "}
        {MODULE_QUESTION_COUNT} questions per module. A full test is two
        modules, a half is one. You&apos;ll upload the questions on the next
        screen.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Title
          <input
            type="text"
            name="title"
            required
            maxLength={120}
            placeholder="Practice Test 3"
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Description (shown to students on the start screen)
          <textarea
            name="description"
            rows={2}
            maxLength={500}
            className={FIELD_CLASS}
          />
        </label>

        <div className="flex flex-wrap gap-6">
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Difficulty
            <select name="difficulty" defaultValue="medium" className={FIELD_CLASS}>
              {DIFFICULTIES.map((difficulty) => (
                <option key={difficulty} value={difficulty}>
                  {DIFFICULTY_LABELS[difficulty]}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-muted">Type</legend>
            <div className="flex gap-4 pt-1.5">
              <label className="flex items-center gap-2 text-[0.9375rem] text-ink">
                <input
                  type="radio"
                  name="testType"
                  value="full"
                  defaultChecked
                  className="accent-accent"
                />
                Full — 2 modules, {MODULE_QUESTION_COUNT * 2} questions
              </label>
              <label className="flex items-center gap-2 text-[0.9375rem] text-ink">
                <input
                  type="radio"
                  name="testType"
                  value="half"
                  className="accent-accent"
                />
                Half — 1 module, {MODULE_QUESTION_COUNT} questions
              </label>
            </div>
          </fieldset>
        </div>

        {/* Stated plainly because it cannot be undone: the database has no
            UPDATE grant on `test_type`, so a mistake here means creating a
            new test. */}
        <p className="text-sm text-muted">
          Type is permanent — it decides the scoring denominator, so it
          can&apos;t change once attempts exist.
        </p>

        {state.status !== "ok" && (
          <p
            role="alert"
            className="rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
          >
            {state.message}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-accent px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {pending ? "Creating…" : "Create & add questions"}
          </button>
        </div>
      </form>
    </section>
  );
}
