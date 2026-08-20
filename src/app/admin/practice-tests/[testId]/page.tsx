import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EditPracticeTestPanel } from "@/components/admin/EditPracticeTestPanel";
import { UploadTestQuestionsPanel } from "@/components/admin/UploadTestQuestionsPanel";
import { getAdminPracticeTest } from "@/lib/admin/data";
import { MODULE_QUESTION_COUNT } from "@/lib/admin/schemas";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Edit practice test",
};

/**
 * One test: its front matter, and its question upload.
 *
 * The route param is untrusted URL input — anything that is not a UUID is a
 * 404 before it reaches a query, and the `admin_practice_tests` view returns
 * zero rows to a non-admin regardless.
 */
export default async function AdminPracticeTestPage({
  params,
}: {
  params: Promise<{ testId: string }>;
}) {
  const { supabase } = await requireAdmin();

  const { testId } = await params;
  const parsedId = z.uuid().safeParse(testId);
  if (!parsedId.success) notFound();

  const test = await getAdminPracticeTest(supabase, parsedId.data);
  if (!test) notFound();

  const hasQuestions = test.module1Count > 0 || test.module2Count > 0;
  const ready =
    test.module1Count === MODULE_QUESTION_COUNT &&
    (test.moduleCount === 1 || test.module2Count === MODULE_QUESTION_COUNT);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          {test.title}
        </h1>
        <Link
          href="/admin/practice-tests"
          className="text-sm font-semibold text-accent hover:text-accent-hover"
        >
          ← All practice tests
        </Link>
      </div>

      <p className="mt-2 text-[0.9375rem] text-muted">
        {test.testType === "full" ? "Full test" : "Half test"} ·{" "}
        {test.moduleCount} module{test.moduleCount === 1 ? "" : "s"} ·{" "}
        {test.attemptCount} attempt{test.attemptCount === 1 ? "" : "s"} recorded
      </p>

      {!ready && (
        <p className="mt-4 rounded-xl border border-insight-hairline bg-insight-surface px-4 py-3 text-[0.9375rem] text-insight-dark">
          This test isn&apos;t usable yet. Module 1 has {test.module1Count} of{" "}
          {MODULE_QUESTION_COUNT} questions
          {test.moduleCount === 2 && (
            <>
              {" "}
              and module 2 has {test.module2Count} of {MODULE_QUESTION_COUNT}
            </>
          )}
          . Upload a complete file below.
        </p>
      )}

      {!test.isActive && (
        <p className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink">
          This test is hidden from students. Restore it from the list to make it
          available again.
        </p>
      )}

      <div className="mt-8">
        <EditPracticeTestPanel test={test} />
      </div>

      <UploadTestQuestionsPanel
        testId={test.id}
        testType={test.testType}
        hasQuestions={hasQuestions}
      />
    </div>
  );
}
