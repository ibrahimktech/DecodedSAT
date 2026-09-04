import { withApi } from "@/lib/api";
import { APP_ALLOWED_ORIGINS } from "@/lib/api-origins";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const GET = withApi(
  {
    rateLimit: { limit: 120, windowMs: 60_000 },
    rateLimitPrefix: "analytics-context",
    allowedOrigins: APP_ALLOWED_ORIGINS,
  },
  async () => {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json(
        { actor: "anonymous", userId: null },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const [{ data: isAdmin, error: adminError }, { data: profile }] =
      await Promise.all([
        supabase.rpc("is_admin"),
        supabase
          .from("profiles")
          .select("created_at")
          .eq("id", user.id)
          .maybeSingle(),
      ]);

    if (adminError) throw adminError;

    return Response.json(
      isAdmin === true
        ? { actor: "admin", userId: user.id }
        : {
            actor: "student",
            userId: user.id,
            createdAt: profile?.created_at ?? user.created_at,
          },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
