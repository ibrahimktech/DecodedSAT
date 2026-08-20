"use client";

/**
 * Create / rename / soft-delete for dynamic video categories.
 *
 * The create form derives a URL name from the category name as you type, but
 * stops the moment the URL name is edited by hand — otherwise correcting the
 * slug and then fixing a typo in the name would silently throw the correction
 * away.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createVideoCategoryAction,
  setVideoCategoryActiveAction,
  updateVideoCategoryAction,
} from "@/app/admin/video-categories/actions";
import type { AdminVideoCategory } from "@/lib/admin/types";

const FIELD_CLASS =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/** Mirrors `slugify` in the action, which is what actually decides the value. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64);
}

export function VideoCategoryAdmin({
  categories,
}: {
  categories: AdminVideoCategory[];
}) {
  return (
    <>
      <CreateCategoryForm />

      <section aria-label="Category list" className="mt-8">
        <p className="mb-3 text-sm text-muted">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"}
        </p>

        {categories.length === 0 ? (
          <div className="rounded-2xl border border-hairline bg-surface px-6 py-10 text-center text-[0.9375rem] text-muted">
            No categories yet. Create one above, then file general videos under
            it on the Videos page.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {categories.map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function CreateCategoryForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const submit = () => {
    setMessage(null);
    setSaved(false);
    startTransition(async () => {
      const result = await createVideoCategoryAction({
        name,
        slug: effectiveSlug,
      });
      if (result.status === "ok") {
        setName("");
        setSlug("");
        setSlugTouched(false);
        setSaved(true);
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  };

  return (
    <section
      aria-label="Add a category"
      className="mt-8 rounded-2xl border border-hairline bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold text-ink">
        Add a category
      </h2>
      <p className="mt-1 text-sm text-muted">
        Categories group general videos that don&apos;t belong to one subtopic —
        &ldquo;Desmos tips&rdquo;, &ldquo;Test-day strategy&rdquo;. They apply to
        videos only; questions and practice tests keep the fixed domain and
        subtopic structure.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium text-muted">
          Name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Desmos tips"
            maxLength={60}
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium text-muted">
          URL name
          <input
            type="text"
            value={effectiveSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            placeholder="desmos-tips"
            maxLength={64}
            className={FIELD_CLASS}
          />
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={pending || name.trim() === ""}
          className="rounded-xl bg-accent px-5 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add category"}
        </button>
      </div>

      {message && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}

      {saved && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-accent bg-accent-chip px-4 py-3 text-sm font-medium text-accent"
        >
          Category created. It appears on the student video page once a video
          is filed under it.
        </p>
      )}
    </section>
  );
}

function CategoryRow({ category }: { category: AdminVideoCategory }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateVideoCategoryAction({
        id: category.id,
        name,
        slug,
      });
      if (result.status === "ok") {
        setEditing(false);
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  };

  const toggleActive = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setVideoCategoryActiveAction({
        id: category.id,
        active: !category.isActive,
      });
      if (result.status === "ok") router.refresh();
      else setMessage(result.message);
    });
  };

  return (
    <li
      className={`rounded-2xl border bg-surface p-4 ${
        category.isActive ? "border-hairline" : "border-miss-hairline"
      }`}
    >
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium text-muted">
            Name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium text-muted">
            URL name
            <input
              type="text"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              maxLength={64}
              className={FIELD_CLASS}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-xl bg-accent px-4 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(category.name);
                setSlug(category.slug);
                setMessage(null);
              }}
              className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-background hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-bold text-ink">
              {category.name}
              {!category.isActive && (
                <span className="ml-2 rounded-lg bg-miss-surface px-2 py-0.5 text-xs font-semibold text-miss-ink">
                  Hidden
                </span>
              )}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              /videos?category={category.slug} · {category.videoCount} video
              {category.videoCount === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={toggleActive}
              disabled={pending}
              className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {category.isActive ? "Hide" : "Restore"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}
    </li>
  );
}
