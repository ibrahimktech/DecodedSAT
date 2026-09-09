import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppNotification = {
  id: string;
  kind: "question_report_resolved";
  message: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications(
  supabase: SupabaseClient,
): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, message, link_url, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error(
      `[notifications] list failed: ${error.code ?? "no_code"} — ${error.message}`,
    );
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    kind: row.kind as AppNotification["kind"],
    message: row.message as string,
    linkUrl: (row.link_url as string | null) ?? null,
    readAt: (row.read_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}
