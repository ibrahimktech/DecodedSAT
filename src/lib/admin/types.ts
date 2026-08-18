/**
 * Shared shapes for the admin panel.
 *
 * Imported by both Server Components and client components (the upload panel,
 * the inline editors), so this module must stay free of server-only imports —
 * types and constants only.
 */

import type { Difficulty } from "@/lib/learn/types";

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
};

export type AdminVideo = {
  id: string;
  title: string;
  youtubeId: string;
  description: string;
  isActive: boolean;
  subtopicId: string;
  subtopicName: string;
  domainId: string;
};

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

/** What most admin write actions resolve to. */
export type AdminActionResult =
  | { status: "ok" }
  | { status: "error" | "rate_limited"; message: string };

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
