"use client";

/**
 * "Where does this video go?" — the shared control on both the add and the
 * edit video forms.
 *
 * A video is filed under EITHER a subtopic (the targeted explainer a missed
 * question links to) OR a dynamic category (general material — Desmos tips,
 * test-day strategy). The radio is the discriminant, and the state it produces
 * is the same union `SaveVideoSchema` parses, so the form cannot construct a
 * shape the server will reject.
 *
 * A category can be created inline: filing a video is when you discover you
 * need a shelf for it, and bouncing to another page to make one loses the
 * lookup you just did.
 */

import { useState, useTransition } from "react";
import { createVideoCategoryAction } from "@/app/admin/video-categories/actions";
import type { AdminVideoCategory, VideoPlacement } from "@/lib/admin/types";
import type { Domain, Subtopic } from "@/lib/learn/types";

const FIELD_CLASS =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

type Props = {
  placement: VideoPlacement;
  onChange: (placement: VideoPlacement) => void;
  domains: Domain[];
  subtopics: Subtopic[];
  categories: AdminVideoCategory[];
  /** Distinguishes the radio group when two of these render on one page. */
  idPrefix: string;
};

export function VideoPlacementFields({
  placement,
  onChange,
  domains,
  subtopics,
  categories,
  idPrefix,
}: Props) {
  /**
   * The domain select is pure UI state: only the subtopic id is submitted, so
   * the domain exists to narrow the second dropdown. Seeded from the current
   * subtopic so opening the edit form on an existing video shows the right
   * domain rather than resetting to the first one.
   */
  const [domainId, setDomainId] = useState(() => {
    if (placement.kind === "domain") {
      const current = subtopics.find(
        (subtopic) => subtopic.id === placement.subtopicId,
      );
      if (current) return current.domainId;
    }
    return domains[0]?.id ?? "";
  });

  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState(categories);
  const [pending, startTransition] = useTransition();

  const domainSubtopics = subtopics.filter(
    (subtopic) => subtopic.domainId === domainId,
  );

  // Soft-deleted categories stay selectable only while they are already the
  // video's category — offering a hidden shelf for a new video would file it
  // somewhere students cannot reach.
  const selectableCategories = localCategories.filter(
    (category) =>
      category.isActive ||
      (placement.kind === "category" &&
        category.id === placement.videoCategoryId),
  );

  const createCategory = () => {
    setCategoryError(null);
    startTransition(async () => {
      const result = await createVideoCategoryAction({
        name: newCategoryName,
        slug: "",
      });

      if (result.status !== "ok") {
        setCategoryError(result.message);
        return;
      }

      setLocalCategories((current) => [
        ...current,
        {
          id: result.id,
          name: result.name,
          slug: result.slug,
          isActive: true,
          videoCount: 0,
        },
      ]);
      onChange({ kind: "category", videoCategoryId: result.id });
      setNewCategoryName("");
      setCreatingCategory(false);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium text-muted">
          Video type
        </legend>

        <label className="flex items-center gap-2 text-[0.9375rem] text-ink">
          <input
            type="radio"
            name={`${idPrefix}-video-type`}
            checked={placement.kind === "domain"}
            onChange={() =>
              onChange({
                kind: "domain",
                subtopicId:
                  placement.kind === "domain" ? placement.subtopicId : "",
              })
            }
            className="accent-accent"
          />
          Domain video
        </label>

        <label className="flex items-center gap-2 text-[0.9375rem] text-ink">
          <input
            type="radio"
            name={`${idPrefix}-video-type`}
            checked={placement.kind === "category"}
            onChange={() =>
              onChange({
                kind: "category",
                videoCategoryId:
                  placement.kind === "category"
                    ? placement.videoCategoryId
                    : "",
              })
            }
            className="accent-accent"
          />
          General video
        </label>
      </fieldset>

      {placement.kind === "domain" ? (
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Domain
            <select
              value={domainId}
              onChange={(event) => {
                setDomainId(event.target.value);
                // The old subtopic belongs to the old domain; keeping it would
                // save a video under a subtopic the dropdown no longer offers.
                onChange({ kind: "domain", subtopicId: "" });
              }}
              className={FIELD_CLASS}
            >
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Subtopic
            <select
              value={placement.subtopicId}
              onChange={(event) =>
                onChange({ kind: "domain", subtopicId: event.target.value })
              }
              className={FIELD_CLASS}
            >
              <option value="">Choose a subtopic…</option>
              {domainSubtopics.map((subtopic) => (
                <option key={subtopic.id} value={subtopic.id}>
                  {subtopic.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Category
              <select
                value={placement.videoCategoryId}
                onChange={(event) =>
                  onChange({
                    kind: "category",
                    videoCategoryId: event.target.value,
                  })
                }
                className={FIELD_CLASS}
              >
                <option value="">Choose a category…</option>
                {selectableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.isActive ? "" : " (hidden)"}
                  </option>
                ))}
              </select>
            </label>

            {!creatingCategory && (
              <button
                type="button"
                onClick={() => setCreatingCategory(true)}
                className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
              >
                New category
              </button>
            )}
          </div>

          {creatingCategory && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-hairline bg-background p-3">
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium text-muted">
                New category name
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="Desmos tips"
                  maxLength={60}
                  className={FIELD_CLASS}
                />
              </label>
              <button
                type="button"
                onClick={createCategory}
                disabled={pending || newCategoryName.trim() === ""}
                className="rounded-xl bg-accent px-4 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingCategory(false);
                  setNewCategoryName("");
                  setCategoryError(null);
                }}
                className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-surface hover:text-ink"
              >
                Cancel
              </button>
            </div>
          )}

          {categoryError && (
            <p
              role="alert"
              className="rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm font-medium text-miss-ink"
            >
              {categoryError}
            </p>
          )}

          {selectableCategories.length === 0 && !creatingCategory && (
            <p className="text-sm text-muted">
              No categories yet — create one to file this video under.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** True once the placement names something the server will accept. */
export function isPlacementComplete(placement: VideoPlacement): boolean {
  return placement.kind === "domain"
    ? placement.subtopicId !== ""
    : placement.videoCategoryId !== "";
}
