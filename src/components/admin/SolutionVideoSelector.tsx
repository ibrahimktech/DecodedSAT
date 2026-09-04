"use client";

import { useMemo, useState } from "react";
import type { AdminVideoOption } from "@/lib/admin/types";

const SEARCH_LIMIT = 8;

function videoContext(video: AdminVideoOption): string | null {
  return video.subtopicName ?? video.categoryName;
}

export function SolutionVideoSelector({
  idPrefix,
  videos,
  selectedId,
  onChange,
  error,
}: {
  idPrefix: string;
  videos: AdminVideoOption[];
  selectedId: string | null;
  onChange: (videoId: string | null) => void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = videos.find((video) => video.id === selectedId) ?? null;
  const inputId = `${idPrefix}-solution-video-search`;
  const listId = `${idPrefix}-solution-video-options`;

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return videos
      .filter((video) => video.isActive)
      .filter((video) => {
        if (!normalized) return true;
        return `${video.title} ${videoContext(video) ?? ""}`
          .toLocaleLowerCase()
          .includes(normalized);
      })
      .slice(0, SEARCH_LIMIT);
  }, [query, videos]);

  const choose = (video: AdminVideoOption) => {
    onChange(video.id);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-muted"
      >
        Solution video <span className="font-normal">(optional)</span>
      </label>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        Link the exact walkthrough for this question. Students only see active
        videos after answering.
      </p>

      {selected ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-insight-hairline bg-insight-surface px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold text-ink">
              {selected.title}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {videoContext(selected) ?? "General video"}
              {!selected.isActive && " · Inactive — hidden from students"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-miss-ink transition-colors hover:bg-miss-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Remove
          </button>
        </div>
      ) : selectedId ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2.5">
          <p className="text-sm text-miss-ink">
            The linked video is unavailable. Remove it or choose a replacement.
          </p>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-miss-ink underline"
          >
            Remove
          </button>
        </div>
      ) : null}

      <div className="relative mt-2">
        <input
          id={inputId}
          type="search"
          role="combobox"
          value={query}
          placeholder={selected ? "Search videos to replace…" : "Search videos…"}
          autoComplete="off"
          aria-autocomplete="list"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${idPrefix}-solution-video-error` : undefined}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && matches[activeIndex]
              ? `${idPrefix}-solution-video-${matches[activeIndex].id}`
              : undefined
          }
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(0, matches.length - 1)),
              );
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.max(0, current - 1));
              return;
            }
            if (event.key === "Enter" && open && matches[activeIndex]) {
              event.preventDefault();
              choose(matches[activeIndex]);
            }
          }}
          className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />

        {open && (
          <div
            id={listId}
            role="listbox"
            aria-label="Solution videos"
            className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-hairline bg-surface p-1.5 shadow-nav"
          >
            {matches.length > 0 ? (
              matches.map((video, index) => (
                <button
                  key={video.id}
                  id={`${idPrefix}-solution-video-${video.id}`}
                  type="button"
                  role="option"
                  aria-selected={video.id === selectedId}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(video)}
                  className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    index === activeIndex
                      ? "bg-accent-chip"
                      : "hover:bg-background"
                  }`}
                >
                  <span className="block truncate text-sm font-semibold text-ink">
                    {video.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {videoContext(video) ?? "General video"}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-center text-sm text-muted">
                {videos.some((video) => video.isActive)
                  ? "No videos match that search."
                  : "No active videos are available yet."}
              </p>
            )}
          </div>
        )}
      </div>
      {error && (
        <p
          id={`${idPrefix}-solution-video-error`}
          className="mt-1 text-sm font-medium text-miss-ink"
        >
          {error}
        </p>
      )}
    </div>
  );
}
