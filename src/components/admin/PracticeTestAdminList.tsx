"use client";

/**
 * The admin practice test list, with soft delete/restore inline.
 *
 * Editing lives on each test's own page rather than expanding in place — a
 * test's page is also where its questions are uploaded, and splitting those
 * across two surfaces would mean two places to check whether a test is
 * actually ready.
 *
 * The "ready" badge is the useful signal here: a test row exists the moment
 * it is created, but it is not usable until its modules are full.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setPracticeTestActiveAction } from "@/app/admin/practice-tests/actions";
import { MODULE_QUESTION_COUNT } from "@/lib/admin/schemas";
import type { AdminPracticeTest } from "@/lib/admin/types";
import { DIFFICULTY_LABELS } from "@/lib/learn/types";

export function PracticeTestAdminList({
  tests,
}: {
  tests: AdminPracticeTest[];
}) {
  if (tests.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface px-6 py-10 text-center text-[0.9375rem] text-muted">
        No practice tests yet. Create one above, then upload its questions.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {tests.map((test) => (
        <TestRow key={test.id} test={test} />
      ))}
    </ul>
  );
}

function TestRow({ test }: { test: AdminPracticeTest }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const expectedPerModule = MODULE_QUESTION_COUNT;
  const ready =
    test.module1Count === expectedPerModule &&
    (test.moduleCount === 1 || test.module2Count === expectedPerModule);

  const toggleActive = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setPracticeTestActiveAction({
        id: test.id,
        active: !test.isActive,
      });
      if (result.status === "ok") router.refresh();
      else setMessage(result.message);
    });
  };

  return (
    <li
      className={`rounded-2xl border bg-surface p-4 ${
        test.isActive ? "border-hairline" : "border-miss-hairline"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold leading-snug text-ink">
            <Link
              href={`/admin/practice-tests/${test.id}`}
              className="transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {test.title}
            </Link>
          </h3>

          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-lg bg-accent-chip px-2 py-0.5 text-accent">
              {test.testType === "full" ? "Full" : "Half"}
            </span>
            <span className="rounded-lg bg-insight-chip px-2 py-0.5 text-insight-dark">
              {DIFFICULTY_LABELS[test.difficulty]}
            </span>
            {ready ? (
              <span className="rounded-lg bg-accent-chip px-2 py-0.5 text-accent">
                Ready
              </span>
            ) : (
              <span className="rounded-lg bg-miss-surface px-2 py-0.5 text-miss-ink">
                Needs questions
              </span>
            )}
            {!test.isActive && (
              <span className="rounded-lg bg-miss-surface px-2 py-0.5 text-miss-ink">
                Hidden
              </span>
            )}
          </p>

          <p className="mt-2 text-sm text-muted">
            Module 1: {test.module1Count}/{expectedPerModule}
            {test.moduleCount === 2 && (
              <>
                {" "}
                · Module 2: {test.module2Count}/{expectedPerModule}
              </>
            )}{" "}
            · {test.attemptCount} attempt{test.attemptCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link
            href={`/admin/practice-tests/${test.id}`}
            className="rounded-xl border border-hairline px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-background"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={toggleActive}
            disabled={pending}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              test.isActive
                ? "border border-miss-hairline text-miss-ink hover:bg-miss-surface"
                : "border border-accent text-accent hover:bg-accent-chip"
            }`}
          >
            {test.isActive ? "Hide" : "Restore"}
          </button>
        </div>
      </div>

      {message && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}
    </li>
  );
}
