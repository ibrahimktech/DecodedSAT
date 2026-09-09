"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPopupAction,
  setPopupActiveAction,
  updatePopupAction,
} from "@/app/admin/popups/actions";
import type { AdminPopup } from "@/lib/admin/types";

const FIELD_CLASS =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

type PopupDraft = {
  title: string;
  message: string;
  buttonText: string;
  buttonUrl: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  showOnce: boolean;
  minAnsweredQuestions: string;
  minAccountAgeDays: string;
};

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function emptyDraft(): PopupDraft {
  return {
    title: "",
    message: "",
    buttonText: "",
    buttonUrl: "",
    isActive: true,
    startsAt: "",
    endsAt: "",
    showOnce: true,
    minAnsweredQuestions: "",
    minAccountAgeDays: "",
  };
}

function popupDraft(popup: AdminPopup): PopupDraft {
  return {
    title: popup.title,
    message: popup.message,
    buttonText: popup.buttonText ?? "",
    buttonUrl: popup.buttonUrl ?? "",
    isActive: popup.isActive,
    startsAt: toDateTimeLocal(popup.startsAt),
    endsAt: toDateTimeLocal(popup.endsAt),
    showOnce: popup.showOnce,
    minAnsweredQuestions: popup.minAnsweredQuestions?.toString() ?? "",
    minAccountAgeDays: popup.minAccountAgeDays?.toString() ?? "",
  };
}

function payload(draft: PopupDraft) {
  return {
    ...draft,
    startsAt: new Date(draft.startsAt).toISOString(),
    endsAt: draft.endsAt === "" ? "" : new Date(draft.endsAt).toISOString(),
    minAnsweredQuestions:
      draft.minAnsweredQuestions === ""
        ? null
        : Number(draft.minAnsweredQuestions),
    minAccountAgeDays:
      draft.minAccountAgeDays === "" ? null : Number(draft.minAccountAgeDays),
  };
}

export function PopupAdmin({ popups }: { popups: AdminPopup[] }) {
  return (
    <>
      <PopupForm mode="create" />

      <section aria-label="Popup list" className="mt-8">
        <p className="mb-3 text-sm text-muted">
          {popups.length} popup{popups.length === 1 ? "" : "s"}
        </p>
        {popups.length === 0 ? (
          <div className="rounded-2xl border border-hairline bg-surface px-6 py-10 text-center text-[0.9375rem] text-muted">
            No popups yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {popups.map((popup) => (
              <PopupRow key={popup.id} popup={popup} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function PopupForm({
  mode,
  popup,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  popup?: AdminPopup;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<PopupDraft>(() =>
    popup ? popupDraft(popup) : emptyDraft(),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <Key extends keyof PopupDraft>(
    key: Key,
    value: PopupDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  function submit() {
    setMessage(null);
    setSaved(false);
    if (draft.startsAt === "") {
      setMessage("Choose a start date.");
      return;
    }

    startTransition(async () => {
      const values = payload(draft);
      const result =
        mode === "create"
          ? await createPopupAction(values)
          : await updatePopupAction({ ...values, id: popup?.id });

      if (result.status === "ok") {
        if (mode === "create") {
          setDraft(emptyDraft());
          setSaved(true);
        }
        onSaved?.();
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  }

  return (
    <section
      className={`rounded-2xl border border-hairline bg-surface p-5 ${
        mode === "create" ? "mt-8" : "mt-4"
      }`}
    >
      <h2 className="font-display text-xl font-bold text-ink">
        {mode === "create" ? "Create a popup" : "Edit popup"}
      </h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            onChange={(event) => set("title", event.target.value)}
            maxLength={120}
            required
            className={FIELD_CLASS}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Message">
            <textarea
              value={draft.message}
              onChange={(event) => set("message", event.target.value)}
              maxLength={2000}
              rows={4}
              required
              className={`${FIELD_CLASS} resize-y`}
            />
          </Field>
        </div>

        <Field label="Button text (optional)">
          <input
            type="text"
            value={draft.buttonText}
            onChange={(event) => set("buttonText", event.target.value)}
            maxLength={60}
            placeholder="Share feedback"
            className={FIELD_CLASS}
          />
        </Field>

        <Field label="Button URL (optional)">
          <input
            type="text"
            value={draft.buttonUrl}
            onChange={(event) => set("buttonUrl", event.target.value)}
            maxLength={1000}
            placeholder="/settings or https://…"
            className={FIELD_CLASS}
          />
        </Field>

        <Field label="Starts">
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(event) => set("startsAt", event.target.value)}
            required
            suppressHydrationWarning
            className={FIELD_CLASS}
          />
        </Field>

        <Field label="Ends (optional)">
          <input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(event) => set("endsAt", event.target.value)}
            suppressHydrationWarning
            className={FIELD_CLASS}
          />
        </Field>

        <Field label="Minimum answered questions (optional)">
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={draft.minAnsweredQuestions}
            onChange={(event) =>
              set("minAnsweredQuestions", event.target.value)
            }
            placeholder="20"
            className={FIELD_CLASS}
          />
        </Field>

        <Field label="Minimum account age in days (optional)">
          <input
            type="number"
            min={1}
            max={36_500}
            value={draft.minAccountAgeDays}
            onChange={(event) => set("minAccountAgeDays", event.target.value)}
            placeholder="30"
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <p className="mt-3 text-xs text-muted">
        Leave both eligibility fields empty to show this to everyone. If both
        are filled, a user must meet both conditions. Dates use your local time.
      </p>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        <Checkbox
          label="Active"
          checked={draft.isActive}
          onChange={(checked) => set("isActive", checked)}
        />
        <Checkbox
          label="Show only once per eligible user"
          checked={draft.showOnce}
          onChange={(checked) => set("showOnce", checked)}
        />
      </div>

      {message && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-accent bg-accent-chip px-4 py-3 text-sm font-medium text-accent"
        >
          Popup created.
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || draft.title.trim() === "" || draft.message.trim() === ""}
          className="rounded-xl bg-accent px-5 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : mode === "create" ? "Create popup" : "Save"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-xl border border-hairline px-5 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-background hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}

function PopupRow({ popup }: { popup: AdminPopup }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    setMessage(null);
    startTransition(async () => {
      const result = await setPopupActiveAction({
        id: popup.id,
        active: !popup.isActive,
      });
      if (result.status === "ok") router.refresh();
      else setMessage(result.message);
    });
  }

  return (
    <li className="rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold text-ink">
              {popup.title}
            </h2>
            <span
              className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${
                popup.isActive
                  ? "bg-accent-chip text-accent"
                  : "bg-miss-surface text-miss-ink"
              }`}
            >
              {popup.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 max-w-2xl whitespace-pre-line text-sm text-muted">
            {popup.message}
          </p>
          <p className="mt-2 text-xs text-muted">
            <span suppressHydrationWarning>{formatWindow(popup)}</span> ·{" "}
            {eligibilityLabel(popup)} ·{" "}
            {popup.showOnce ? "Once per user" : "May repeat"}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={pending}
            className="rounded-xl border border-hairline px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {pending ? "Saving…" : popup.isActive ? "Deactivate" : "Activate"}
          </button>
        </div>
      </div>

      {message && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}

      {editing && (
        <PopupForm
          mode="edit"
          popup={popup}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
    </li>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}

function formatWindow(popup: AdminPopup): string {
  const format = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${format.format(new Date(popup.startsAt))} – ${
    popup.endsAt ? format.format(new Date(popup.endsAt)) : "no end date"
  }`;
}

function eligibilityLabel(popup: AdminPopup): string {
  const conditions: string[] = [];
  if (popup.minAnsweredQuestions !== null) {
    conditions.push(`${popup.minAnsweredQuestions}+ answers`);
  }
  if (popup.minAccountAgeDays !== null) {
    conditions.push(`${popup.minAccountAgeDays}+ account days`);
  }
  return conditions.length === 0 ? "Everyone" : conditions.join(" and ");
}
