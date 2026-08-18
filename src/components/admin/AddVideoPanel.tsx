"use client";

/**
 * Two-step add-video flow for /admin/videos.
 *
 * Step 1: paste a URL or id → the lookup action extracts the id and asks
 * YouTube's oEmbed endpoint (server-side) for the title. A video YouTube
 * won't serve — private, deleted, mistyped — fails *here*, with the error
 * inline, before any save is possible.
 *
 * Step 2: the title arrives pre-filled but editable, the description is
 * hand-written (oEmbed has none), domain/subtopic come from the fixed
 * dropdowns. Save re-verifies against oEmbed server-side anyway.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addVideoAction, lookupVideoAction } from "@/app/admin/videos/actions";
import type { Domain, Subtopic } from "@/lib/learn/types";

type LookupInfo = {
  youtubeId: string;
  title: string;
  authorName: string;
};

export function AddVideoPanel({
  domains,
  subtopics,
}: {
  domains: Domain[];
  subtopics: Subtopic[];
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<LookupInfo | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const [subtopicId, setSubtopicId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const domainSubtopics = subtopics.filter(
    (subtopic) => subtopic.domainId === domainId,
  );

  const fieldClass =
    "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

  const runLookup = () => {
    setMessage(null);
    setSaved(false);
    startTransition(async () => {
      const result = await lookupVideoAction({ input });
      if (result.status === "ok") {
        setLookup({
          youtubeId: result.youtubeId,
          title: result.title,
          authorName: result.authorName,
        });
        setTitle(result.title);
      } else {
        setLookup(null);
        setMessage(result.message);
      }
    });
  };

  const save = () => {
    if (!lookup) return;
    setMessage(null);
    startTransition(async () => {
      const result = await addVideoAction({
        youtubeId: lookup.youtubeId,
        title,
        description,
        subtopicId,
      });
      if (result.status === "ok") {
        // Reset to step 1 for the next video; the refreshed list below shows
        // the one that just landed.
        setInput("");
        setLookup(null);
        setTitle("");
        setDescription("");
        setSubtopicId("");
        setSaved(true);
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  };

  return (
    <section
      aria-label="Add a video"
      className="mt-8 rounded-2xl border border-hairline bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold text-ink">Add a video</h2>
      <p className="mt-1 text-sm text-muted">
        Paste a YouTube link (watch, youtu.be, or shorts) or the 11-character
        video id.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          maxLength={200}
          className={`${fieldClass} min-w-64 flex-1`}
        />
        <button
          type="button"
          onClick={runLookup}
          disabled={pending || input.trim() === ""}
          className="rounded-xl bg-accent px-4 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && !lookup ? "Checking…" : "Fetch details"}
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

      {saved && !lookup && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-accent bg-accent-chip px-4 py-3 text-sm font-medium text-accent"
        >
          Video saved. It&apos;s live in the student library now.
        </p>
      )}

      {lookup && (
        <div className="mt-4 flex flex-col gap-3 border-t border-hairline pt-4 sm:flex-row sm:gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${encodeURIComponent(lookup.youtubeId)}/hqdefault.jpg`}
            alt=""
            className="aspect-video w-full max-w-60 shrink-0 self-start rounded-xl object-cover"
          />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-sm text-muted">
              Found on YouTube
              {lookup.authorName && (
                <>
                  {" "}
                  — channel: <strong className="text-ink">{lookup.authorName}</strong>
                </>
              )}
            </p>

            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Title (pre-filled from YouTube, edit freely)
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Description (shown in the student library)
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={2000}
                className={fieldClass}
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Domain
                <select
                  value={domainId}
                  onChange={(event) => {
                    setDomainId(event.target.value);
                    setSubtopicId("");
                  }}
                  className={fieldClass}
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
                  value={subtopicId}
                  onChange={(event) => setSubtopicId(event.target.value)}
                  className={fieldClass}
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

            <div>
              <button
                type="button"
                onClick={save}
                disabled={pending || title.trim() === "" || subtopicId === ""}
                className="rounded-xl bg-accent px-5 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save video"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
