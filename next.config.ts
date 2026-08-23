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
 *
 * Third-party origins are listed one vendor at a time, each scoped to the exact
 * host and the exact directives it needs, never a wildcard and never a
 * loosened directive shared between two of them.
 */

/**
 * The explainer-video library embeds YouTube's player in an iframe. Two
 * origins, each named for exactly what it does:
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
 * The Desmos graphing calculator, offered on every question — embedded as an
 * iframe, so `frame-src` is the whole allowance.
 *
 * It previously loaded `calculator.js` into this origin through the Desmos
 * JavaScript API, and that cost three additional directives: `script-src` for
 * the bundle, `font-src data:` for its embedded maths fonts, `worker-src blob:`
 * for the worker it evaluates in — and, fatally, `'unsafe-eval'`, because the
 * bundle initialises with a top-level `eval()` and compiles expressions with
 * `new Function(...)`.
 *
 * Granting `'unsafe-eval'` beside `'unsafe-inline'` removes most of what
 * script-src is for, and it had to be granted on the two routes that render the
 * most content. Embedding moves all of that into Desmos's own origin, under
 * Desmos's own policy, and this app gets its strict policy back everywhere.
 * See `<CalculatorPanel />` for what the swap costs.
 */
const DESMOS_ORIGIN = "https://www.desmos.com";

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
].join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${YOUTUBE_THUMBNAIL_ORIGIN}`,
  // `data:` covers inline font payloads in bundled stylesheets. No third-party
  // font origin is permitted.
  "font-src 'self' data:",
  // Both third-party embeds are iframes, so this is the only directive either
  // of them needs. `frame-src` falls back to `default-src 'self'`, which would
  // block both, so it has to be stated outright.
  `frame-src 'self' ${YOUTUBE_EMBED_ORIGIN} ${DESMOS_ORIGIN}`,
  // Unrelated to the above: this governs who may frame *us*, and stays closed.
  "frame-ancestors 'none'",
  "connect-src 'self'",
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
