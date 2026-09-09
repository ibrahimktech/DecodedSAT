import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EligiblePopup = {
  id: string;
  title: string;
  message: string;
  buttonText: string | null;
  buttonUrl: string | null;
  showOnce: boolean;
};

/**
 * The RPC both chooses and records one popup. It returns at most one row and
 * never accepts a user id; auth.uid() is the identity and eligibility source.
 */
export async function getEligiblePopup(
  supabase: SupabaseClient,
): Promise<EligiblePopup | null> {
  const { data, error } = await supabase.rpc("get_eligible_popup").maybeSingle();

  if (error) {
    console.error(
      `[popups] eligibility failed: ${error.code ?? "no_code"} — ${error.message}`,
    );
    return null;
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    title: row.title as string,
    message: row.message as string,
    buttonText: (row.button_text as string | null) ?? null,
    buttonUrl: (row.button_url as string | null) ?? null,
    showOnce: row.show_once as boolean,
  };
}
