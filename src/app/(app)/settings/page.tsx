import type { Metadata } from "next";
import { signOutAction } from "@/app/auth/actions";
import { PasswordForm } from "@/components/app/PasswordForm";
import { StudyPlanForm } from "@/components/app/StudyPlanForm";
import { ctaClassName } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import { getProfile, getUserStats } from "@/lib/learn/data";

export const metadata: Metadata = {
  title: "Settings",
};

/** Mirrors SAT_ATTEMPT_OPTIONS; anything higher falls back to "N times". */
const SAT_ATTEMPT_LABELS: Record<number, string> = {
  0: "Not yet",
  1: "Once",
  2: "Two or more times",
};

/**
 * Account info, password change, and the study plan.
 *
 * The plan section is the editable half of onboarding: the flow itself closes
 * permanently once finished, but target score, daily goal and test date all
 * legitimately change and live here afterwards. The current-score estimate and
 * the SAT history are shown read-only — they are the baseline progress is
 * measured against, and `update_study_plan()` cannot write them.
 *
 * The logout button here is in addition to the nav rail's, per the spec.
 */
export default async function SettingsPage() {
  const { supabase, user } = await requireUser();

  const [profile, stats] = await Promise.all([
    getProfile(supabase, user.id),
    getUserStats(supabase, user.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Settings
        </h1>
      </header>

      {/* --- Account ------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">Account</h2>
        <dl className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-[0.9375rem] text-muted">Name</dt>
            <dd className="text-[0.9375rem] font-medium text-ink">
              {profile?.fullName ?? "—"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-[0.9375rem] text-muted">Email</dt>
            <dd className="text-[0.9375rem] font-medium text-ink">
              {profile?.email ?? user.email ?? "—"}
            </dd>
          </div>
        </dl>
      </section>

      {/* --- Password ------------------------------------------------------ */}
      <section className="mt-4 rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">
          Change password
        </h2>
        <div className="mt-4">
          <PasswordForm />
        </div>
      </section>

      {/* --- Study plan ---------------------------------------------------- */}
      <section className="mt-4 rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">Study plan</h2>
        <p className="mt-1 text-sm text-muted">
          Change these whenever they stop being true.
        </p>
        <div className="mt-4">
          <StudyPlanForm
            plan={{
              targetScore: stats.targetScore,
              dailyGoal: stats.dailyGoal,
              testDate: stats.testDate,
            }}
          />
        </div>
      </section>

      {/* --- Starting point (read-only) ------------------------------------- */}
      <section className="mt-4 rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">
          Your starting point
        </h2>
        <p className="mt-1 text-sm text-muted">
          Captured during setup. Fixed on purpose — it&apos;s what your progress
          is measured against.
        </p>
        <dl className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-[0.9375rem] text-muted">
              Math score when you started
            </dt>
            <dd className="text-[0.9375rem] font-medium text-ink">
              {stats.currentScoreEstimate ?? "—"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-[0.9375rem] text-muted">Taken the SAT</dt>
            <dd className="text-[0.9375rem] font-medium text-ink">
              {SAT_ATTEMPT_LABELS[stats.satAttempts] ??
                `${stats.satAttempts} times`}
            </dd>
          </div>
          {stats.lastSatMathScore !== null && (
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[0.9375rem] text-muted">Last Math score</dt>
              <dd className="text-[0.9375rem] font-medium text-ink">
                {stats.lastSatMathScore}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* --- Sign out ------------------------------------------------------ */}
      <form action={signOutAction} className="mt-6">
        <button type="submit" className={ctaClassName("secondary")}>
          Sign out
        </button>
      </form>
    </div>
  );
}
