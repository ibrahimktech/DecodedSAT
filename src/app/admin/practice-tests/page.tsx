import type { Metadata } from "next";
import Link from "next/link";
import { CreatePracticeTestPanel } from "@/components/admin/CreatePracticeTestPanel";
import { PracticeTestAdminList } from "@/components/admin/PracticeTestAdminList";
import { listAdminPracticeTests } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Practice tests",
};

/**
 * Full and half practice tests: create, list, hide, restore.
 *
 * Distinct from the section drills, which are seeded content and have no
 * admin surface. These have real module rules, so they need one.
 */
export default async function AdminPracticeTestsPage() {
  const { supabase } = await requireAdmin();
  const tests = await listAdminPracticeTests(supabase);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Practice tests
        </h1>
        <Link
          href="/admin"
          className="text-sm font-semibold text-accent hover:text-accent-hover"
        >
          ← Overview
        </Link>
      </div>

      <CreatePracticeTestPanel />

      <section aria-label="Practice test list" className="mt-8">
        <p className="mb-3 text-sm text-muted">
          {tests.length} test{tests.length === 1 ? "" : "s"}
        </p>
        <PracticeTestAdminList tests={tests} />
      </section>
    </div>
  );
}
