import type { Metadata } from "next";
import { TURNSTILE_SITE_KEY } from "@/lib/env";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a free DecodedSAT account to track which SAT math mistakes you keep making.",
  // Auth screens have nothing to rank for, and indexed sign-up pages attract
  // scripted traffic.
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Create your account
        </h1>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Free, and it stays free.
        </p>
      </div>

      {/* Public key by design — it is rendered into the widget markup. */}
      <SignupForm turnstileSiteKey={TURNSTILE_SITE_KEY} />
    </>
  );
}
