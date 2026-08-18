import type { NextConfig } from "next";

/**
 * Response headers applied to every route.
 *
 * On `script-src 'unsafe-inline'`: Next.js inlines its RSC payload and
 * hydration bootstrap. Removing that allowance requires per-request nonces from
 * middleware, which forces dynamic rendering and would defeat static
 * generation for a page that is identical for every visitor. The rest of the
 * policy is still tight — framing and plugins are off, and `base-uri`/
 * `form-action` are locked to self. Revisit with nonces if a route ever needs
 * to be dynamic anyway.
 */

/**
 * The only third-party origin this site permits, and it is here because the
 * auth forms cannot work without it: Turnstile loads its script from this host,
 * runs the challenge in an iframe served from it, and posts the result back to
 * it. That is three separate directives — miss any one and the widget fails
 * with a generic "could not load", because a CSP violation looks identical to
 * a network error from inside the page.
 *
 * Scoped to this exact host, never a wildcard. Nothing else third-party is
 * allowed; if another vendor is ever added it gets its own explicit entry
 * rather than a loosened directive.
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The explainer-video library embeds YouTube's player in an iframe. Two
 * origins, each named for exactly what it does, per the one-entry-per-vendor
 * rule above:
 *
 * - The privacy-enhanced embed host serves the player iframe. Only
 *   `frame-src` needs it — the player's own scripts run inside its iframe,
 *   in YouTube's origin, and never touch this page's script-src.
 * - The thumbnail host serves the poster images the library shows before a
 *   video is clicked (loading the heavy player only on demand).
 */
const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
const YOUTUBE_THUMBNAIL_ORIGIN = "https://i.ytimg.com";

/**
 * React's development build calls `eval()` to reconstruct callstacks across
 * environments, and logs a warning on every page load when the CSP forbids it.
 *
 * Granted only here. `next dev` sets NODE_ENV to "development" and `next build`
 * sets it to "production", so this cannot leak into a deployed bundle — which
 * matters, because 'unsafe-eval' alongside 'unsafe-inline' would undo most of
 * what the script-src directive is for.
 */
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  TURNSTILE_ORIGIN,
].join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${YOUTUBE_THUMBNAIL_ORIGIN}`,
  "font-src 'self'",
  // Turnstile reports the solved challenge back to Cloudflare from the page.
  `connect-src 'self' ${TURNSTILE_ORIGIN}`,
  // The challenge itself renders in an iframe from this origin. `frame-src`
  // has no fallback of its own here beyond `default-src 'self'`, which is why
  // it has to be stated explicitly. The YouTube embed host rides in the same
  // directive for the video library.
  `frame-src 'self' ${TURNSTILE_ORIGIN} ${YOUTUBE_EMBED_ORIGIN}`,
  // Unrelated to the above: this governs who may frame *us*, and stays closed.
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework version.
  poweredByHeader: false,

  // A stray package-lock.json in the home directory otherwise makes Turbopack
  // infer the workspace root as C:\Users\Ibrahim.
  turbopack: { root: __dirname },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
