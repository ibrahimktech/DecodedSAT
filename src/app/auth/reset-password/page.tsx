import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { FormMessage } from "@/components/auth/FormMessage";
import {
  isNetworkError,
  NETWORK_ERROR_MESSAGE,
} from "@/lib/auth/error-messages";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-session";
import { PASSWORD_MIN } from "@/lib/auth/schemas";
import { describeError } from "@/lib/auth/describe-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Choose a new password for your DecodedSAT account.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const RESET_LINK_ERRORS: Record<string, string> = {
  expired: "This password reset link has expired. Request a new one.",
  invalid: "This password reset link is invalid or has already been used.",
  connection: NETWORK_ERROR_MESSAGE,
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const callbackError = params.error
    ? RESET_LINK_ERRORS[params.error]
    : undefined;

  let hasRecoverySession = false;
  let sessionError: string | undefined;
  if (!callbackError) {
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error && isNetworkError(error)) sessionError = NETWORK_ERROR_MESSAGE;
      const marker = (await cookies()).get(PASSWORD_RECOVERY_COOKIE)?.value;
      hasRecoverySession = Boolean(user && marker === user.id);
    } catch (error) {
      console.error(`[auth] reset page session check threw: ${describeError(error)}`);
      if (isNetworkError(error)) sessionError = NETWORK_ERROR_MESSAGE;
    }
  }

  const unavailableMessage =
    callbackError ??
    sessionError ??
    (!hasRecoverySession
      ? "This password reset link is invalid or has already been used."
      : undefined);

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Choose a new password
        </h1>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Use at least {PASSWORD_MIN} characters and choose something unique.
        </p>
      </div>

      {unavailableMessage ? (
        <div className="flex flex-col gap-5">
          <FormMessage>{unavailableMessage}</FormMessage>
          <p className="text-center text-[0.9375rem] text-muted">
            <Link
              href="/auth/forgot-password"
              className="font-semibold text-accent transition-colors hover:text-accent-hover"
            >
              Request a new reset link
            </Link>
          </p>
        </div>
      ) : (
        <ResetPasswordForm />
      )}
    </>
  );
}
