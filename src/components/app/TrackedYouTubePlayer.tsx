"use client";

import { useEffect, useRef } from "react";
import { trackStudentEvent } from "@/lib/analytics/client";

type PlayerStateEvent = { data: number };
type YoutubePlayer = {
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
};
type YoutubeNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onStateChange: (event: PlayerStateEvent) => void;
      };
    },
  ) => YoutubePlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
};

declare global {
  interface Window {
    YT?: YoutubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YoutubeNamespace> | null = null;

function loadYoutubeApi(): Promise<YoutubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };

    if (!document.querySelector('script[data-decoded-youtube-api="true"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.decodedYoutubeApi = "true";
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

type TrackedYouTubePlayerProps = {
  videoId: string;
  youtubeId: string;
  title: string;
  videoType: "general" | "explanation";
  questionId?: string;
};

/** Privacy-enhanced YouTube player that writes meaningful milestones only. */
export function TrackedYouTubePlayer({
  videoId,
  youtubeId,
  title,
  videoType,
  questionId,
}: TrackedYouTubePlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let player: YoutubePlayer | null = null;
    let timer: number | null = null;
    let playing = false;
    let started = false;
    let completed = false;
    let endedOnce = false;
    let abandoned = false;
    let watchedSeconds = 0;
    let lastWallTime = 0;
    let lastPlayerTime = 0;
    const milestones = new Set<number>();

    const eventName = (suffix: string) =>
      `${videoType === "explanation" ? "explanation_video" : "video"}_${suffix}` as Parameters<
        typeof trackStudentEvent
      >[0];

    const common = (progressPercent?: number) => ({
      video_id: videoId,
      question_id: questionId,
      video_type: videoType,
      source: videoType === "explanation" ? "question_explanation" : "video_library",
      progress_percent: progressPercent,
      watched_seconds: Math.min(Math.round(watchedSeconds), 86_400),
    });

    const stopTimer = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };

    const accrueWatchTime = () => {
      if (!playing || lastWallTime === 0) return;
      const now = performance.now();
      watchedSeconds += Math.min((now - lastWallTime) / 1_000, 2);
      lastWallTime = now;
    };

    const recordAbandonment = () => {
      accrueWatchTime();
      if (!started || completed || abandoned || watchedSeconds < 3) return;
      abandoned = true;
      const duration = player?.getDuration() || 0;
      const current = player?.getCurrentTime() || 0;
      const percent = duration > 0 ? Math.min(99, Math.round((current / duration) * 100)) : 0;
      trackStudentEvent(eventName("abandoned"), common(percent));
    };

    const poll = () => {
      if (!player || !playing) return;
      accrueWatchTime();
      const current = player.getCurrentTime();
      const duration = player.getDuration();
      if (duration <= 0) return;

      const jumpedBy = Math.abs(current - lastPlayerTime - 1);
      if (lastPlayerTime > 0 && jumpedBy > 5) {
        trackStudentEvent(eventName("seeked"), common(Math.round((current / duration) * 100)));
      }
      lastPlayerTime = current;

      const percent = (current / duration) * 100;
      for (const milestone of [25, 50, 75]) {
        if (percent >= milestone && !milestones.has(milestone)) {
          milestones.add(milestone);
          trackStudentEvent(eventName(String(milestone)), common(milestone));
        }
      }
    };

    void loadYoutubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      player = new YT.Player(hostRef.current, {
        videoId: youtubeId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, playsinline: 1 },
        events: {
          onReady: () => undefined,
          onStateChange: ({ data }) => {
            if (!player) return;
            if (data === YT.PlayerState.PLAYING) {
              if (endedOnce) {
                endedOnce = false;
                completed = false;
                abandoned = false;
                milestones.clear();
                trackStudentEvent(eventName("replayed"), common(0));
              } else if (!started) {
                started = true;
                trackStudentEvent(eventName("started"), common(0));
              }
              playing = true;
              lastWallTime = performance.now();
              lastPlayerTime = player.getCurrentTime();
              if (timer === null) timer = window.setInterval(poll, 1_000);
            } else {
              accrueWatchTime();
              playing = false;
              stopTimer();
              if (data === YT.PlayerState.ENDED) {
                completed = true;
                endedOnce = true;
                milestones.add(25);
                milestones.add(50);
                milestones.add(75);
                trackStudentEvent(eventName("completed"), common(100));
              }
            }
          },
        },
      });
    });

    const onPageHide = () => recordAbandonment();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onPageHide);
      recordAbandonment();
      stopTimer();
      player?.destroy();
    };
  }, [questionId, videoId, videoType, youtubeId]);

  return (
    <div
      ref={hostRef}
      title={title}
      aria-label={`Video player: ${title}`}
      className="h-full w-full"
    />
  );
}

