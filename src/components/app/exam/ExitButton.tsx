"use client";

/**
 * The way out, top-left.
 *
 * Before this there was none: a student mid-module could reach Submit, or use
 * the browser's back button, and nothing else. The browser's back button is the
 * bad option — during a timed test it looks like an escape hatch and is
 * actually a way to leave a running clock behind without being told that is
 * what you did.
 *
 * ## Why this confirms on its own
 *
 * `PracticeTestRunner` registers a `beforeunload` guard, but that only fires on
 * a real document unload. A Next client-side navigation is not one, so a plain
 * `<Link>` here would leave a live module silently. The dialog below is the
 * guard for that path, and it says the thing that actually matters: the clock
 * does not stop.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { examButtonClassName } from "@/components/app/exam/ExamShell";

type ExitButtonProps = {
  href: string;
  /** Button text, e.g. "Go back" or "Change filters". */
  label: string;
  /**
   * Omit to leave immediately. Present on a timed module, where leaving has a
   * consequence worth stating before it happens.
   */
  confirm?: {
    heading: string;
    body: string;
    confirmLabel: string;
  };
  onLeave?: () => void;
};

export function ExitButton({ href, label, confirm, onLeave }: ExitButtonProps) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  const leave = () => {
    onLeave?.();
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (confirm ? setAsking(true) : leave())}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-background hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m14 6-6 6 6 6" />
        </svg>
        {label}
      </button>

      {asking && confirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6">
            <h2
              id="exit-heading"
              className="font-display text-xl font-bold text-ink"
            >
              {confirm.heading}
            </h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
              {confirm.body}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAsking(false)}
                className={examButtonClassName("secondary")}
              >
                Keep working
              </button>
              <button
                type="button"
                onClick={leave}
                className={examButtonClassName("primary")}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
