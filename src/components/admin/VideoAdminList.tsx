"use client";

/**
 * The admin video list with inline editing and soft delete/restore.
 *
 * Editing covers title, description, domain/subtopic, and the video itself:
 * "Fetch title" re-runs the oEmbed lookup on whatever link/id is in the
 * video field, so swapping a video refreshes its metadata the same way the
 * add flow fetched it. The save action re-verifies the id against oEmbed
 * regardless.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  lookupVideoAction,
  setVideoActiveAction,
  updateVideoAction,
} from "@/app/admin/videos/actions";
import {
  isPlacementComplete,
  VideoPlacementFields,
} from "@/components/admin/VideoPlacementFields";
import type {
  AdminVideo,
  AdminVideoCategory,
  VideoPlacement,
} from "@/lib/admin/types";
import type { Domain, Subtopic } from "@/lib/learn/types";

type Props = {
  videos: AdminVideo[];
  domains: Domain[];
  subtopics: Subtopic[];
  categories: AdminVideoCategory[];
};

/**
 * Reads the row's stored placement back into the form's union.
 *
 * `subtopic_id` wins when both somehow exist: the CHECK only requires at
 * least one, and a domain video is the older, more specific filing.
 */
function placementOf(video: AdminVideo): VideoPlacement {
  if (video.subtopicId) {
    return { kind: "domain", subtopicId: video.subtopicId };
  }
  return { kind: "category", videoCategoryId: video.categoryId ?? "" };
}

export function VideoAdminList({
  videos,
  domains,
  subtopics,
  categories,
}: Props) {
  if (videos.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface px-6 py-10 text-center text-[0.9375rem] text-muted">
        No videos match these filters. Add one above.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {videos.map((video) => (
        <VideoRow
          key={video.id}
          video={video}
          domains={domains}
          subtopics={subtopics}
          categories={categories}
        />
      ))}
    </ul>
  );
}

function VideoRow({
  video,
  domains,
  subtopics,
  categories,
}: {
  video: AdminVideo;
  domains: Domain[];
  subtopics: Subtopic[];
  categories: AdminVideoCategory[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const domainName =
    domains.find((domain) => domain.id === video.domainId)?.name ?? "";

  const toggleActive = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await setVideoActiveAction({
        id: video.id,
        active: !video.isActive,
      });
      if (result.status === "ok") {
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  };

  return (
    <li
      className={`rounded-2xl border bg-surface p-4 ${
        video.isActive ? "border-hairline" : "border-miss-hairline"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.ytimg.com/vi/${encodeURIComponent(video.youtubeId)}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          className="aspect-video w-full max-w-48 shrink-0 self-start rounded-xl object-cover"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-bold leading-snug text-ink">
                {video.title}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold">
                {/* Green for a subtopic, amber for a category — the same
                    distinction the student library draws. */}
                {video.subtopicName ? (
                  <span className="rounded-lg bg-accent-chip px-2 py-0.5 text-accent">
                    {domainName} · {video.subtopicName}
                  </span>
                ) : (
                  <span className="rounded-lg bg-insight-chip px-2 py-0.5 text-insight-dark">
                    {video.categoryName ?? "Uncategorised"}
                  </span>
                )}
                <span className="rounded-lg bg-background px-2 py-0.5 font-mono text-muted">
                  {video.youtubeId}
                </span>
                {!video.isActive && (
                  <span className="rounded-lg bg-miss-surface px-2 py-0.5 text-miss-ink">
                    Inactive
                  </span>
                )}
              </p>
              {video.description && (
                <p className="mt-2 line-clamp-2 text-sm text-muted">
                  {video.description}
                </p>
              )}
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setEditing((current) => !current);
                }}
                className="rounded-xl border border-hairline px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-background"
              >
                {editing ? "Close" : "Edit"}
              </button>
              <button
                type="button"
                onClick={toggleActive}
                disabled={pending}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  video.isActive
                    ? "border border-miss-hairline text-miss-ink hover:bg-miss-surface"
                    : "border border-accent text-accent hover:bg-accent-chip"
                }`}
              >
                {video.isActive ? "Deactivate" : "Restore"}
              </button>
            </div>
          </div>

          {message && !editing && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2 text-sm font-medium text-miss-ink"
            >
              {message}
            </p>
          )}
        </div>
      </div>

      {editing && (
        <VideoEditForm
          video={video}
          domains={domains}
          subtopics={subtopics}
          categories={categories}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}

function VideoEditForm({
  video,
  domains,
  subtopics,
  categories,
  onSaved,
}: {
  video: AdminVideo;
  domains: Domain[];
  subtopics: Subtopic[];
  categories: AdminVideoCategory[];
  onSaved: () => void;
}) {
  const [videoInput, setVideoInput] = useState(video.youtubeId);
  const [youtubeId, setYoutubeId] = useState(video.youtubeId);
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [placement, setPlacement] = useState<VideoPlacement>(() =>
    placementOf(video),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fieldClass =
    "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

  /** Re-fetch oEmbed for whatever link/id is in the video field. */
  const refetch = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await lookupVideoAction({ input: videoInput });
      if (result.status === "ok") {
        setYoutubeId(result.youtubeId);
        setVideoInput(result.youtubeId);
        setTitle(result.title);
      } else {
        setMessage(result.message);
      }
    });
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateVideoAction({
        id: video.id,
        youtubeId,
        title,
        description,
        ...placement,
      });
      if (result.status === "ok") {
        onSaved();
      } else {
        setMessage(result.message);
      }
    });
  };

  const videoChanged = videoInput.trim() !== youtubeId;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-hairline pt-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-muted">
        Video (link or id)
        <span className="flex flex-wrap gap-2">
          <input
            type="text"
            value={videoInput}
            onChange={(event) => setVideoInput(event.target.value)}
            maxLength={200}
            className={`${fieldClass} min-w-56 flex-1`}
          />
          <button
            type="button"
            onClick={refetch}
            disabled={pending || videoInput.trim() === ""}
            className="rounded-xl border border-hairline px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-background disabled:opacity-50"
          >
            Fetch title
          </button>
        </span>
        {videoChanged && (
          <span className="text-xs font-medium text-insight-dark">
            Press “Fetch title” to verify the new video before saving.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-muted">
        Title
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-muted">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={2000}
          className={fieldClass}
        />
      </label>

      <VideoPlacementFields
        idPrefix={`edit-${video.id}`}
        placement={placement}
        onChange={setPlacement}
        domains={domains}
        subtopics={subtopics}
        categories={categories}
      />

      {message && (
        <p
          role="alert"
          className="rounded-xl border border-miss-hairline bg-miss-surface px-3 py-2 text-sm font-medium text-miss-ink"
        >
          {message}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={
            pending ||
            videoChanged ||
            title.trim() === "" ||
            !isPlacementComplete(placement)
          }
          className="rounded-xl bg-accent px-5 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
