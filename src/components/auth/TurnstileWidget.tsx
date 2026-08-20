"use client";

/**
 * Cloudflare Turnstile, rendered explicitly.
 *
 * Hand-rolled rather than pulled from a wrapper package: the whole integration
 * is one script tag and one `render` call, and CLAUDE.md asks that dependencies
 * earn their place. Cloudflare's script is the only third-party code involved.
 *
 * Explicit rendering (`render=explicit`) instead of the implicit `cf-turnstile`
 * class, because implicit mode scans the DOM on script load and cannot see a
 * widget React mounts afterwards.
 *
 * The token is a UX gate only. Nothing here is a security boundary — Supabase
 * verifies the token server-side against the secret in its dashboard, so a
 * caller who skips this component entirely is rejected there.
 */

import { useEffect, useRef, useState } from "react";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileOptions = {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  /** Cloudflare passes a numeric error code, e.g. "110200" for a disallowed hostname. */
  "error-callback"?: (code?: string) => void;
};

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Module-level so the script is fetched once even if two widgets ever mount,
 * and so a failed load can be retried on the next mount.
 */
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

type TurnstileWidgetProps = {
  siteKey: string;
  /** Labels the challenge in Cloudflare's analytics. */
  action: string;
  /** Receives the token, or `null` whenever the current one stops being valid. */
  onToken: (token: string | null) => void;
  /**
   * Bumped by the parent after every server response. Turnstile tokens are
   * single-use, so the one in hand after a failed submit is already spent —
   * resubmitting it fails for a reason the person cannot see. Changing this
   * value resets the widget and clears the stale token.
   */
  resetKey: number;
};

export function TurnstileWidget({
  siteKey,
  action,
  onToken,
  resetKey,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  /**
   * Null while healthy, otherwise why it broke.
   *
   * Kept as a reason rather than a boolean because the two failure modes are
   * indistinguishable on screen and need opposite fixes: a blocked script is a
   * CSP or network problem on our side, while an error code from a script that
   * did load is a Cloudflare-side rejection (110200 = hostname not on the
   * widget's domain list, 110100 = bad sitekey).
   */
  const [failure, setFailure] = useState<string | null>(null);

  // Kept in a ref so a new inline callback from the parent never re-runs the
  // mount effect and re-renders the widget.
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: "light",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "timeout-callback": () => onTokenRef.current(null),
          "error-callback": (code) => {
            onTokenRef.current(null);
            console.error("[turnstile] challenge error", { code });
            setFailure(code ? `error ${code}` : "challenge error");
          },
        });
      })
      .catch((error) => {
        if (cancelled) return;
        // Overwhelmingly a CSP `script-src` omission rather than a real network
        // failure — the browser reports both the same way to this handler.
        console.error(
          "[turnstile] script did not load. Check that the CSP in " +
            "next.config.ts allows https://challenges.cloudflare.com in " +
            "script-src, frame-src and connect-src.",
          error,
        );
        setFailure("script blocked");
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    // Skip the initial render; there is no token to clear yet.
    if (resetKey === 0) return;

    // Clear BEFORE resetting, and unconditionally.
    //
    // Both halves matter. `reset()` can invoke the callback with a fresh token
    // straight away, and clearing afterwards would wipe the good token and
    // leave the button dead. And if the script never loaded, the old token has
    // to go anyway — keeping it means the next submit replays a token
    // Cloudflare has already redeemed, which comes back as
    // `timeout-or-duplicate` and looks to the person like the form is broken.
    onTokenRef.current(null);

    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetKey]);

  /**
   * Re-challenge when the page is restored from the back/forward cache.
   *
   * A restored page brings React state back with it, including a token that
   * was already spent on the submit the person navigated away from. The widget
   * still shows its "Success!" tick, so nothing on screen suggests a problem —
   * they submit, and Cloudflare rejects the replay. Discarding the token on
   * restore is what makes the back button safe here.
   */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      onTokenRef.current(null);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    };

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (!siteKey) {
    return (
      <p className="rounded-xl border border-insight-hairline bg-insight-surface px-4 py-3 text-sm text-insight-dark">
        Verification is not configured. Set{" "}
        <code className="font-mono">NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> in
        your <code className="font-mono">.env.local</code> to enable this form.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} />
      {failure && (
        <p role="alert" className="mt-2 text-sm text-miss-ink">
          The verification check could not load. Please refresh and try again.
          {/* The reason is for whoever is fixing it, not for a student sitting
              in front of a broken form — so it shows in dev and stays out of
              production, where it is only ever in the console. */}
          {process.env.NODE_ENV !== "production" && (
            <span className="ml-1 font-mono text-xs">({failure})</span>
          )}
        </p>
      )}
    </div>
  );
}
