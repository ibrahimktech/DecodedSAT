"use client";

import { useEffect, useState, useTransition } from "react";
import { dismissPopupAction } from "@/app/popups/actions";
import type { EligiblePopup } from "@/lib/popups";

export function UserPopup({ popup }: { popup: EligiblePopup | null }) {
  const [open, setOpen] = useState(popup !== null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (!popup || !open) return null;

  function dismiss(after?: () => void) {
    if (!popup) return;
    setOpen(false);
    startTransition(async () => {
      await dismissPopupAction({ popupId: popup.id });
      after?.();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) dismiss();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`popup-title-${popup.id}`}
        className="relative w-full max-w-lg rounded-2xl border border-hairline bg-surface p-6 shadow-xl sm:p-7"
      >
        <button
          type="button"
          onClick={() => dismiss()}
          disabled={pending}
          aria-label="Dismiss popup"
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <h2
          id={`popup-title-${popup.id}`}
          className="pr-10 font-display text-2xl font-extrabold text-ink"
        >
          {popup.title}
        </h2>
        <p className="mt-3 whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-muted">
          {popup.message}
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => dismiss()}
            disabled={pending}
            className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold text-muted transition-colors hover:bg-background hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          >
            Dismiss
          </button>
          {popup.buttonText && popup.buttonUrl && (
            <button
              type="button"
              onClick={() =>
                dismiss(() => window.location.assign(popup.buttonUrl as string))
              }
              disabled={pending}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
            >
              {popup.buttonText}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
