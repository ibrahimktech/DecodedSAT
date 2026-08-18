import type { Metadata } from "next";
import { signOutAction } from "@/app/auth/actions";
import { PasswordForm } from "@/components/app/PasswordForm";
import { ctaClassName } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import { getProfile, getUserStats } from "@/lib/learn/data";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Account info, password change, and a visible placeholder for the daily
 * goal — which stays a fixed default until onboarding introduces
 * user-configurable settings, so there is deliberately no control for it.
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

      {/* --- Preferences placeholder --------------------------------------- */}
      <section className="mt-4 rounded-2xl border border-dashed border-hairline p-6">
        <h2 className="font-display text-xl font-bold text-ink">Preferences</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.9375rem] text-muted">Daily goal</p>
          <p className="text-[0.9375rem] font-medium text-ink">
            {stats.dailyGoal} questions
          </p>
        </div>
        <p className="mt-2 text-sm text-muted">
          Customizing your daily goal arrives with onboarding — coming soon.
        </p>
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
