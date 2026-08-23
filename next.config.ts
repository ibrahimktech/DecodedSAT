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
 * this host serves the embedded video player,
 * runs the challenge in an iframe served from it, and posts the result back to
 * it. That is three separate directives — miss any one and the widget fails
 * with a generic "could not load", because a CSP violation looks identical to
 * a network error from inside the page.
 *
 * Scoped to this exact host, never a wildcard. Nothing else third-party is
 * allowed; if another vendor is ever added it gets its own explicit entry
 * rather than a loosened directive.
 */

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
 * The Desmos graphing calculator, offered on every question. Its own entry,
 * per the one-vendor-one-entry rule above, and it needs THREE directives —
 * easy to under-specify, since a CSP violation surfaces inside the page as an
 * indistinguishable "couldn't load":
 *
 * - `script-src`, for `calculator.js` itself.
 * - `font-src data:`, because the bundle carries its own maths fonts as three
 *   `@font-face` rules with `url(data:font/...)`. Without it the script runs
 *   and the calculator renders with no glyphs.
 * - `worker-src blob:`, because it runs evaluation off the main thread in a
 *   worker built from a Blob:
 *       URL.createObjectURL(new Blob([__dcg_worker_source__], …))
 *   `worker-src` falls back to `child-src` and then to `default-src 'self'`,
 *   which does not cover `blob:` — so this must be stated outright.
 *
 * `img-src` deliberately does NOT gain `blob:`. That would only be needed for
 * Desmos's image-upload feature, which is switched off in `<CalculatorPanel />`
 * (`images: false`) because the real digital SAT does not offer it either.
 */
const DESMOS_ORIGIN = "https://www.desmos.com";

/**
 * The routes that mount the calculator, and the only ones granted
 * `'unsafe-eval'`.
 *
 * Desmos needs it. Its bundle initialises with an unguarded top-level
 * `eval(__dcg_shared_module_source__)` and compiles expressions with
 * `new Function(...)`, so without the grant the IIFE throws on load, never
 * assigns `window.Desmos`, and the panel reports "couldn't load" with no
 * indication that a policy was involved.
 *
 * This is why the calculator worked in development and not in production for
 * the same API key: `next dev` was already granting `'unsafe-eval'` for React's
 * own callstack reconstruction, so the failure only ever appeared once
 * NODE_ENV flipped and the grant went away.
 *
 * Scoped rather than global because `'unsafe-eval'` beside `'unsafe-inline'`
 * undoes most of what script-src is for. These two routes render
 * admin-authored question content and nothing user-generated; the landing
 * page, auth, admin and everything else keep the strict policy.
 */
const CALCULATOR_ROUTES = [
  "/questions/practice",
  "/practice/tests/:testId/take",
];

/**
 * Everything NOT in `CALCULATOR_ROUTES`.
 *
 * A negative lookahead rather than a plain catch-all on purpose: when two
 * `headers()` entries both match a request, Next emits the header twice, and a
 * browser given two CSP headers enforces the intersection — the strict one
 * would still win and the grant above would silently do nothing. Exactly one
 * policy must match any given path.
 */
const NON_CALCULATOR_ROUTES =
  "/((?!questions/practice$|practice/tests/[^/]+/take$).*)";

function buildScriptSrc(allowEval: boolean): string {
  return [
    "'self'",
    "'unsafe-inline'",
    // React's development build calls `eval()` to reconstruct callstacks across
    // environments, and warns on every page load when the CSP forbids it.
    ...(allowEval || process.env.NODE_ENV !== "production"
      ? ["'unsafe-eval'"]
      : []),
    DESMOS_ORIGIN,
  ].join(" ");
}

const buildContentSecurityPolicy = (allowEval: boolean) => [
  "default-src 'self'",
  `script-src ${buildScriptSrc(allowEval)}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${YOUTUBE_THUMBNAIL_ORIGIN}`,
  // `data:` is for Desmos's embedded maths fonts, not for remote loading —
  // no third-party font origin is permitted.
  "font-src 'self' data:",
  // Desmos evaluates expressions in a worker created from a Blob. Nothing
  // else in the app spawns a worker, so `blob:` is the whole allowance.
  "worker-src 'self' blob:",
  "connect-src 'self'",
  // The video player renders in an iframe from this origin. `frame-src`
  // has no fallback of its own here beyond `default-src 'self'`, which is why
  // it has to be stated explicitly. The YouTube embed host rides in the same
  // directive for the video library.
  `frame-src 'self' ${YOUTUBE_EMBED_ORIGIN}`,
  // Unrelated to the above: this governs who may frame *us*, and stays closed.
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
];

const buildSecurityHeaders = (allowEval: boolean) => [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(allowEval).join("; "),
  },
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
    return [
      // The calculator routes first, each matching exactly one path, then
      // everything else via the lookahead that excludes them. No request ever
      // matches two of these — see NON_CALCULATOR_ROUTES for why that matters.
      ...CALCULATOR_ROUTES.map((source) => ({
        source,
        headers: buildSecurityHeaders(true),
      })),
      {
        source: NON_CALCULATOR_ROUTES,
        headers: buildSecurityHeaders(false),
      },
    ];
  },
};

export default nextConfig;
