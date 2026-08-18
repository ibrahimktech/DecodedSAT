import type { Metadata } from "next";
import { TURNSTILE_SITE_KEY } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to DecodedSAT.",
  robots: { index: false, follow: false },
};

/**
 * Notices reachable via `?error=` / `?signed_out=`.
 *
 * A closed set, looked up by key. The query string never supplies the text
 * itself — rendering an attacker-chosen message on our own domain is how a
 * login page ends up hosting someone else's phishing copy. An unrecognised key
 * renders nothing at all.
 */
const NOTICES: Record<string, string> = {
  confirm:
    "That confirmation link didn't work. It may have expired or already been used — sign in below, or create your account again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signed_out?: string }>;
}) {
  const params = await searchParams;
  const notice = params.error ? NOTICES[params.error] : undefined;

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Welcome back
        </h1>
        <p className="mt-2 text-[0.9375rem] text-muted">
          {params.signed_out
            ? "You're signed out. See you soon."
            : "Pick up where you left off."}
        </p>
      </div>

      <LoginForm turnstileSiteKey={TURNSTILE_SITE_KEY} notice={notice} />
    </>
  );
}
