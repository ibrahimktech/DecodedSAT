"use server";

/**
 * Auth actions that are not tied to a single form.
 *
 * Just sign-out for now. It lives here rather than under `login/` or `signup/`
 * because the dashboard is what calls it, and the dashboard should not be
 * reaching into a form directory to find it.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { describeError } from "@/lib/auth/describe-error";
import { ONBOARDED_COOKIE } from "@/lib/auth/onboarded-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    // Scoped to this session, so signing out on a laptop does not kill the
    // same person's phone.
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    // Falling through to the redirect is correct: whatever happened, the
    // person asked to leave, and the cookies are cleared either way.
    console.error(`[auth] sign-out failed: ${describeError(error)}`);
  }

  // The onboarding latch belongs to the session that just ended. It is keyed
  // to the user id, so leaving it would not actually mislead the next person
  // to sign in here — but a cookie outliving the session it describes is the
  // kind of thing that becomes a bug later, and a Server Action is one of the
  // few places that can write cookies.
  (await cookies()).delete(ONBOARDED_COOKIE);

  // Drops anything cached for the signed-in subtree. Not "/" — see the note in
  // `login/actions.ts`.
  revalidatePath("/dashboard", "layout");
  redirect("/auth/login?signed_out=1");
}
