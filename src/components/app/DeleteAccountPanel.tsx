"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/app/(app)/settings/actions";
import { resetAnalyticsIdentity } from "@/lib/analytics/client";

const INITIAL_STATE: DeleteAccountState = {
  status: "idle",
  message: "",
  attempt: 0,
};

export function DeleteAccountPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [state, action, pending] = useActionState(deleteAccountAction, INITIAL_STATE);
  const headingId = useId();

  useEffect(() => {
    if (state.status !== "deleted") return;
    resetAnalyticsIdentity();
    router.replace("/auth/login?account_deleted=1");
  }, [router, state]);

  return (
    <>
      <section className="mt-8 rounded-2xl border border-miss-hairline bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-miss-ink">Danger zone</h2>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-ink">Delete account</h3>
            <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted">
              Permanently delete your DecodedSAT account, progress, attempts,
              and associated personal analytics data.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl border border-miss-ink bg-miss-ink px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-miss-ink"
          >
            Delete account
          </button>
        </div>
      </section>

      {open && state.status !== "deleted" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-miss-hairline bg-surface p-6 shadow-xl">
            <h2 id={headingId} className="font-display text-2xl font-bold text-ink">
              Permanently delete your account?
            </h2>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
              This permanently deletes your DecodedSAT account, progress,
              attempts, and associated personal data. This action cannot be undone.
            </p>
            <form action={action} className="mt-5">
              <label htmlFor="delete-confirmation" className="text-sm font-semibold text-ink">
                Type <span className="font-mono">DELETE</span> to confirm
              </label>
              <input
                id="delete-confirmation"
                name="confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                data-ph-mask
                disabled={pending}
                className="mt-2 w-full rounded-xl border border-hairline bg-background px-3.5 py-3 text-ink outline-none transition-colors focus:border-miss-ink focus:ring-2 focus:ring-miss-ink/15"
              />
              {state.status === "error" && (
                <p role="alert" className="mt-3 text-sm font-medium text-miss-ink">
                  {state.message}
                </p>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setConfirmation("");
                  }}
                  disabled={pending}
                  className="rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || confirmation !== "DELETE"}
                  className="rounded-xl bg-miss-ink px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {pending ? "Deleting…" : "Delete my account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
