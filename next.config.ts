import type { NextConfig } from "next";

/**
 * Response headers applied to every route.
 *
 * On `script-src 'unsafe-inline'`: Next.js inlines its RSC payload and
 * hydration bootstrap. Removing that allowance requires per-request nonces from
 * middleware, which forces dynamic rendering and would defeat static
 * generation for a page that is identical for every visitor. The rest of the
 * policy is still tight — no third-party origins are permitted at all, framing
 * and plugins are off, and `base-uri`/`form-action` are locked to self. Revisit
 * with nonces if a route ever needs to be dynamic anyway.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
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
