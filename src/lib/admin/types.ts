/**
 * Shared shapes for the admin panel.
 *
 * Imported by both Server Components and client components (the upload panel,
 * the inline editors), so this module must stay free of server-only imports —
 * types and constants only.
 */

import type { Difficulty } from "@/lib/learn/types";
import type { QuestionReportReason } from "@/lib/learn/types";

/** A question as the admin sees it — answer key included. */
export type AdminQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  correctChoice: number;
  explanation: string;
  difficulty: Difficulty;
  isActive: boolean;
  externalId: string | null;
  subtopicId: string;
  subtopicName: string;
  domainId: string;
  domainName: string;
  setName: string | null;
  solutionVideo: AdminQuestionSolutionVideo | null;
};

export type AdminQuestionSolutionVideo = {
  id: string;
  title: string;
  isActive: boolean;
};

export const QUESTION_REPORT_STATUSES = [
  "open",
  "reviewed",
  "resolved",
  "dismissed",
] as const;

export type QuestionReportStatus = (typeof QUESTION_REPORT_STATUSES)[number];

export const QUESTION_REPORT_STATUS_LABELS: Record<
  QuestionReportStatus,
  string
> = {
  open: "Open",
  reviewed: "Reviewed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export type AdminQuestionReportSummary = {
  id: string;
  questionId: string;
  reason: QuestionReportReason;
  details: string | null;
  status: QuestionReportStatus;
  createdAt: string;
  reporterName: string | null;
  reporterEmail: string | null;
  currentPrompt: string;
  currentIsActive: boolean;
  externalId: string | null;
  questionReportCount: number;
  openQuestionReportCount: number;
};

export type QuestionReportSnapshot = {
  prompt: string;
  choices: string[];
  correctChoice: number;
};

export type AdminQuestionReport = AdminQuestionReportSummary & {
  userId: string;
  updatedAt: string;
  adminNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  snapshot: QuestionReportSnapshot;
  currentQuestion: AdminQuestion;
};

/**
 * A video as the admin sees it. Exactly one of the subtopic trio and the
 * category pair is populated — the `videos_have_a_type` CHECK guarantees at
 * least one, and the write path never sets both.
 */
export type AdminVideo = {
  id: string;
  title: string;
  youtubeId: string;
  description: string;
  isActive: boolean;
  subtopicId: string | null;
  subtopicName: string | null;
  domainId: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

/** Lightweight video row used by the searchable question-video picker. */
export type AdminVideoOption = AdminQuestionSolutionVideo & {
  subtopicName: string | null;
  categoryName: string | null;
};

export type AdminVideoCategory = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  /** Videos currently filed under it, active and inactive alike. */
  videoCount: number;
};

export type AdminPracticeTest = {
  id: string;
  title: string;
  description: string | null;
  difficulty: Difficulty;
  testType: "full" | "half";
  moduleCount: number;
  isActive: boolean;
  createdAt: string;
  module1Count: number;
  module2Count: number;
  attemptCount: number;
};

/**
 * The practice-test upload's form state.
 *
 * Unlike the question-set upload, which rejects bad ROWS and imports the rest,
 * this is all-or-nothing: a test with 21 questions in module 1 is not a test.
 * So the failure shape is a list of reasons and an import that did not happen.
 */
export type TestUploadState =
  | { status: "idle" }
  | { status: "error" | "rate_limited"; message: string }
  | { status: "rejected"; errors: string[] }
  | { status: "ok"; imported: number; reused: number; linked: number };

export const initialTestUploadState: TestUploadState = { status: "idle" };

export type AdminUserRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  createdAt: string;
  isAdmin: boolean;
  attemptsCount: number;
};

export type QuestionSetOption = {
  id: string;
  name: string;
};

/**
 * Where a video is filed, as the forms hold it. Mirrors the discriminated
 * union in `SaveVideoSchema` so the client state and the server contract
 * cannot drift into disagreeing about what "exactly one of these" means.
 */
export type VideoPlacement =
  | { kind: "domain"; subtopicId: string }
  | { kind: "category"; videoCategoryId: string };

/**
 * Creating a category returns the row, not just a status: the inline
 * "new category" affordance on the video form has to select what it just
 * made, and a bare `{ status: "ok" }` would force a refetch to find the id.
 */
export type CreateCategoryResult =
  | { status: "ok"; id: string; name: string; slug: string }
  | { status: "error" | "rate_limited"; message: string };

/** What most admin write actions resolve to. */
export type AdminActionResult =
  | { status: "ok" }
  | { status: "error" | "rate_limited"; message: string };

/** Manual creation returns the id so the UI can show the new list row. */
export type CreateQuestionResult =
  | { status: "ok"; id: string }
  | {
      status: "error" | "rate_limited";
      message: string;
      fieldErrors?: Record<string, string>;
    };

/** The upload action's form state, rendered as the import summary. */
export type UploadState =
  | { status: "idle" }
  | { status: "error" | "rate_limited"; message: string }
  | {
      status: "ok";
      imported: number;
      skippedDuplicates: number;
      rejected: { externalId: string; reason: string }[];
    };

export const initialUploadState: UploadState = { status: "idle" };

/** What the YouTube lookup action returns to the add/edit video forms. */
export type VideoLookupResult =
  | {
      status: "ok";
      youtubeId: string;
      title: string;
      authorName: string;
      thumbnailUrl: string;
    }
  | { status: "error" | "rate_limited"; message: string };

/** Status filter shared by the questions and videos admin lists. */
export type ActiveStatusFilter = "active" | "inactive" | "all";
