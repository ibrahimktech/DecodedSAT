import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a DecodedSAT password reset link.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Reset your password
        </h1>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Enter your email and we&apos;ll send you a secure reset link.
        </p>
      </div>

      <ForgotPasswordForm />
    </>
  );
}
