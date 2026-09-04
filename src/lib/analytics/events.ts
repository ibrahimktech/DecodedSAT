export const STUDENT_EVENT_NAMES = [
  "practice_started",
  "practice_completed",
  "question_viewed",
  "question_answered",
  "question_skipped",
  "question_gave_up",
  "question_struggled",
  "explanation_opened",
  "explanation_closed",
  "explanation_button_shown",
  "watch_explanation_clicked",
  "explanation_video_started",
  "explanation_video_25",
  "explanation_video_50",
  "explanation_video_75",
  "explanation_video_completed",
  "explanation_video_abandoned",
  "explanation_video_replayed",
  "explanation_video_seeked",
  "video_started",
  "video_25",
  "video_50",
  "video_75",
  "video_completed",
  "video_abandoned",
  "video_replayed",
  "video_seeked",
  "desmos_opened",
  "test_started",
  "test_completed",
  "onboarding_started",
  "onboarding_completed",
  "search_performed",
  "filter_applied",
] as const;

export type StudentEventName = (typeof STUDENT_EVENT_NAMES)[number];

export type StudentEventProperties = {
  question_id?: string;
  video_id?: string;
  practice_session_id?: string;
  correct?: boolean;
  selected_choice?: number;
  answer_time_ms?: number;
  progress_percent?: number;
  watched_seconds?: number;
  used_desmos?: boolean;
  difficulty?: "easy" | "medium" | "hard";
  subtopic?: string;
  source?: string;
  video_type?: "general" | "explanation";
  answer_result?: string;
  search_kind?: string;
  filter_kind?: string;
  path?: string;
  posthog_session_id?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

export type AnalyticsContext =
  | { actor: "admin"; userId: string }
  | { actor: "student"; userId: string; createdAt?: string }
  | { actor: "anonymous"; userId: null };
