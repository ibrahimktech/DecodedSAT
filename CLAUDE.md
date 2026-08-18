# DecodedSAT — project guide

## Overview

DecodedSAT is a free SAT Mathematics studying website. The core mechanic: a student gets a question wrong, the mistake is diagnosed by type, and the student is linked straight to a short explainer video that targets that exact gap — not just more generic practice questions. Built by a solo student developer, for students.

Current phase: landing page only. No diagnostic engine, no question bank, no auth yet — those come later.

## Tech stack

- **Framework:** Next.js, App Router, TypeScript. Use TypeScript everywhere — no `.js`/`.jsx` files.
- **Styling:** Tailwind CSS. Add the palette below as named theme colors in `tailwind.config` — never use raw hex in component code.
- **Hosting:** Vercel, deployed from GitHub. Custom domain: decodedsat.com.
- **Database/auth (later phase, not yet):** Supabase. Do not scaffold this until explicitly asked.
- **Package manager:** npm.

## Design system

| Role | Hex | Use |
|---|---|---|
| Background | `#F1EFE8` | Page background (warm off-white, not stark white) |
| Text primary | `#04342C` | Body copy, headings |
| Text secondary | `#5F5E5A` | Muted/supporting text |
| Accent (brand) | `#1D9E75` | Primary buttons, links, brand elements |
| Accent hover | `#0F6E56` | Button/link hover state |
| Insight/highlight | `#EF9F27` | "Aha" moment elements — explainer video callouts |
| Insight darker | `#BA7517` | Text on amber backgrounds, badges |
| Card surface | `#FFFFFF` | Cards, raised elements on the off-white bg |
| Border | `#D3D1C7` | Hairlines, dividers |

Visual rules:
- Flat fills only. No gradients anywhere.
- No small rounded "eyebrow" badge text above section headers.
- Every "Get started" button uses identical styling everywhere it appears — same colors, shape, and size.
- No fake testimonials or fabricated reviews, ever.
- Rounded corners, generous whitespace, consistent with a flat vector mascot illustration style.

## Security requirements

These apply from the first commit, not as a later pass. Treat every item below as non-negotiable.

### Secrets and environment variables
- API keys, tokens, and credentials live **only** in `.env` or `.env.local`, never hardcoded in source.
- `.env*` files (except `.env.example`) are in `.gitignore` from the first commit — verify this before any secret is ever added.
- Only variables that are genuinely safe for the browser get the `NEXT_PUBLIC_` prefix. Anything else stays server-only and is never referenced in client components.
- No API key, secret, or credential is ever sent to or embedded in frontend/client-side code, under any circumstance. All third-party API calls go through Next.js API routes or server actions, which hold the secret server-side and proxy the request.

### Rate limiting
- Every API route/endpoint has rate limiting applied — no exceptions, including endpoints that feel low-risk.
- Limit by IP address at minimum; by authenticated user ID once auth exists.
- Return HTTP 429 with a clear error body when a limit is exceeded, not a silent failure or generic 500.
- For this phase (no backend data yet), this applies to any contact form, waitlist-style endpoint, or future API route — set it up as a reusable middleware/utility now so it's trivial to apply to every new route going forward.

### Input validation and sanitization
- Every incoming request (body, query params, form input) is validated against a schema (e.g. Zod) before it's used — reject anything that doesn't match, don't attempt to "fix" malformed input.
- Sanitize any user-generated text before storing or rendering it, to prevent XSS.
- Never construct database queries via string concatenation — use parameterized queries / the ORM or client library's built-in query builder exclusively.
- Validate on the server, always — client-side validation is a UX nicety, never a security boundary.

### Caching
- Static or rarely-changing content (marketing copy, video metadata, question bank once it exists) uses Next.js static generation or ISR with a sensible `revalidate` interval, not fetched fresh on every request.
- API responses that are safe to cache get appropriate `Cache-Control` headers and TTLs.
- Never cache user-specific or sensitive data at a shared/edge layer — only cache what's identical for every visitor.

### Auth and access (once Supabase is added)
- Row Level Security is enabled on every table from the moment it's created — never added retroactively.
- All inputs sanitized, validated, rate-limiting added.
- Server-side checks are the source of truth for permissions; never trust a role or permission flag read only on the client.

### General
- HTTPS only (Vercel default — don't disable or work around this).
- API routes restrict CORS to expected origins, not `*`.
- Production error responses never leak stack traces, internal file paths, or raw exception messages to the client — log details server-side, return a generic safe message to the user.
- Keep dependencies current; avoid adding third-party scripts or packages that aren't clearly necessary.


Mascot: a friendly student fox character (SVG provided separately) — used small in the navbar next to the wordmark, larger and prominent in the hero.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
