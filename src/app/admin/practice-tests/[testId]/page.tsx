import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EditPracticeTestPanel } from "@/components/admin/EditPracticeTestPanel";
import { ManualQuestionForm } from "@/components/admin/ManualQuestionForm";
import { PracticeTestQuestionManager } from "@/components/admin/PracticeTestQuestionManager";
import {
  getAdminPracticeTest,
  listAdminPracticeTestQuestions,
  listAdminVideoOptions,
} from "@/lib/admin/data";
import { MODULE_QUESTION_COUNT } from "@/lib/admin/schemas";
import { requireAdmin } from "@/lib/auth/admin";
import { getDomains, getSubtopics } from "@/lib/learn/data";

export const metadata: Metadata = {
  title: "Edit practice test",
};

/**
 * One test: its front matter and manually managed question modules.
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

  const [test, questions, domains, subtopics, videos] = await Promise.all([
    getAdminPracticeTest(supabase, parsedId.data),
    listAdminPracticeTestQuestions(supabase, parsedId.data),
    getDomains(supabase),
    getSubtopics(supabase),
    listAdminVideoOptions(supabase),
  ]);
  if (!test) notFound();

  const ready =
    test.module1ActiveCount === MODULE_QUESTION_COUNT &&
    (test.moduleCount === 1 ||
      test.module2ActiveCount === MODULE_QUESTION_COUNT);

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
          This test isn&apos;t usable yet. Module 1 has {test.module1ActiveCount} of{" "}
          {MODULE_QUESTION_COUNT} active questions
          {test.moduleCount === 2 && (
            <>
              {" "}
              and module 2 has {test.module2ActiveCount} of {MODULE_QUESTION_COUNT}{" "}
              active questions
            </>
          )}
          . Add or restore questions below until every module is complete.
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

      <section className="mt-8">
        <h2 className="font-display text-2xl font-bold text-ink">
          Add a question
        </h2>
        <p className="mt-1 text-sm text-muted">
          This is the same full editor used by the Question Bank and supports
          mixing both question types in either module.
        </p>
        <ManualQuestionForm
          domains={domains}
          subtopics={subtopics}
          questionSets={[]}
          videos={videos}
          practiceTest={{
            id: test.id,
            moduleCount: test.moduleCount,
            module1Count: test.module1Count,
            module2Count: test.module2Count,
          }}
        />
      </section>

      <PracticeTestQuestionManager
        testId={test.id}
        moduleCount={test.moduleCount}
        questions={questions}
        domains={domains}
        subtopics={subtopics}
        videos={videos}
      />
    </div>
  );
}
