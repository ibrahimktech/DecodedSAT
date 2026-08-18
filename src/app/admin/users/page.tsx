import type { Metadata } from "next";
import Link from "next/link";
import { listAdminUsers } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Users",
};

/**
 * Read-only user list. Deliberately no promote/demote/edit controls anywhere
 * in the UI: admin status is granted and revoked only by hand in the SQL
 * editor, so there is no client-reachable path that changes who is an admin
 * — including for admins themselves.
 */
export default async function AdminUsersPage() {
  const { supabase } = await requireAdmin();

  const users = await listAdminUsers(supabase);

  const dateFormat = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Users
        </h1>
        <Link
          href="/admin"
          className="text-sm font-semibold text-accent hover:text-accent-hover"
        >
          ← Overview
        </Link>
      </div>
      <p className="mt-2 text-[0.9375rem] text-muted">
        {users.length} registered user{users.length === 1 ? "" : "s"}. Admin
        access is managed only in the database — this page is view-only.
      </p>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-hairline bg-surface">
        <table className="w-full text-left text-[0.9375rem]">
          <thead>
            <tr className="border-b border-hairline text-sm text-muted">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Signed up</th>
              <th className="px-4 py-3 text-right font-semibold">
                Questions attempted
              </th>
              <th className="px-4 py-3 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-b border-hairline/60 last:border-b-0"
              >
                <td className="px-4 py-3 font-medium text-ink">
                  {user.fullName ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted">{user.email ?? "—"}</td>
                <td className="px-4 py-3 text-muted">
                  {dateFormat.format(new Date(user.createdAt))}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">
                  {user.attemptsCount}
                </td>
                <td className="px-4 py-3">
                  {user.isAdmin ? (
                    <span className="rounded-lg bg-insight-chip px-2 py-0.5 text-xs font-bold text-insight-dark">
                      Admin
                    </span>
                  ) : (
                    <span className="text-sm text-muted">Student</span>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
