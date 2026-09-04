import Link from "next/link";
import type { SolutionVideo } from "@/lib/learn/types";

function PlayIcon({ className }: { className?: string }) {
  return (
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
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 6 4-6 4Z" />
    </svg>
  );
}

/** Exact-question video CTA shared by immediate feedback and test reviews. */
export function SolutionVideoLink({
  video,
  questionId,
  answerResult,
  emphasis,
}: {
  video: SolutionVideo;
  questionId: string;
  answerResult: "correct" | "incorrect";
  emphasis: "primary" | "secondary";
}) {
  const trackingAttributes = {
    "data-question-id": questionId,
    "data-video-id": video.id,
    "data-answer-result": answerResult,
  };

  if (emphasis === "secondary") {
    return (
      <Link
        href={`/videos/${encodeURIComponent(video.id)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Watch solution video: ${video.title}`}
        {...trackingAttributes}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-surface px-3 py-2 text-sm font-semibold text-accent transition-colors hover:border-accent hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <PlayIcon className="shrink-0" />
        Watch solution video
      </Link>
    );
  }

  return (
    <Link
      href={`/videos/${encodeURIComponent(video.id)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Watch video solution: ${video.title}`}
      {...trackingAttributes}
      className="mt-3 flex items-center gap-3 rounded-xl border border-insight-hairline bg-insight-surface px-3.5 py-3 text-insight-dark transition-colors hover:border-insight-dark/40 hover:bg-insight-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <PlayIcon className="shrink-0" />
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-bold">
          Watch video solution
        </span>
        <span className="mt-0.5 block text-sm">
          See this question solved step by step
        </span>
      </span>
    </Link>
  );
}
