import { z } from "zod";
import { withApi } from "@/lib/api";
import { APP_ALLOWED_ORIGINS } from "@/lib/api-origins";
import { STUDENT_EVENT_NAMES } from "@/lib/analytics/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Uuid = z.string().uuid();
const EventName = z.enum([
  ...STUDENT_EVENT_NAMES,
  "session_touched",
  "session_ended",
]);

const EventProperties = z
  .object({
    question_id: Uuid.optional(),
    video_id: Uuid.optional(),
    practice_session_id: Uuid.optional(),
    correct: z.boolean().optional(),
    selected_choice: z.number().int().min(0).max(3).optional(),
    answer_time_ms: z.number().int().min(0).max(7_200_000).optional(),
    progress_percent: z.number().int().min(0).max(100).optional(),
    watched_seconds: z.number().int().min(0).max(86_400).optional(),
    used_desmos: z.boolean().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    subtopic: z.string().trim().max(120).optional(),
    source: z.string().trim().max(80).optional(),
    video_type: z.enum(["general", "explanation"]).optional(),
    answer_result: z.string().trim().max(20).optional(),
    search_kind: z.string().trim().max(40).optional(),
    filter_kind: z.string().trim().max(40).optional(),
    path: z.string().trim().max(500).optional(),
    posthog_session_id: z.string().trim().max(200).optional(),
    referrer: z.string().trim().max(1_000).optional(),
    utm_source: z.string().trim().max(200).optional(),
    utm_medium: z.string().trim().max(200).optional(),
    utm_campaign: z.string().trim().max(200).optional(),
    utm_content: z.string().trim().max(200).optional(),
    utm_term: z.string().trim().max(200).optional(),
  })
  .strict();

const EventRequest = z
  .object({
    sessionId: Uuid,
    eventName: EventName,
    properties: EventProperties,
  })
  .strict();

export const POST = withApi(
  {
    schema: EventRequest,
    rateLimit: { limit: 240, windowMs: 60_000 },
    rateLimitPrefix: "student-analytics-event",
    allowedOrigins: APP_ALLOWED_ORIGINS,
  },
  async ({ data }) => {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Anonymous traffic remains in PostHog. Durable learning data requires a
    // verified student and silently no-ops for signed-out beacons.
    if (!user) return new Response(null, { status: 204 });

    const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
    if (adminError) throw adminError;
    if (isAdmin === true) return new Response(null, { status: 204 });

    const { error } = await supabase.rpc("track_student_event", {
      p_session_id: data.sessionId,
      p_event_name: data.eventName,
      p_properties: data.properties,
    });
    if (error) throw error;

    return new Response(null, { status: 202 });
  },
);
