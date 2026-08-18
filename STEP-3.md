# Step 3: Audit & Harden Signup/Signin — DecodedSAT

## Context

- Step 1 (landing page) is done.
- Step 2 (signup + signin) was built via Claude Code but hasn't been fully verified — it's currently broken in a few ways.
- Stack: Next.js App Router, TypeScript, Supabase Auth + Postgres, `@supabase/ssr` cookie-based sessions, Cloudflare Turnstile (real keys are already wired in), RLS on `profiles`, and a Postgres trigger that creates the `profiles` row only when `email_confirmed_at` transitions from `null`.
- Running on `localhost` only. No domain purchased yet — `NEXT_PUBLIC_APP_URL` drives all redirect URLs, nothing hardcoded.
- Rate limiting is **not implemented** — this was flagged as a TODO in step 2 (Claude Code was told to ask before picking an approach; it's still unresolved).

This step is not about adding features. It's about finding why the current implementation is broken, fixing it, and then auditing it against a security/session checklist before moving on to step 4.

## Reported bugs (fix these first, in this order)

### 1. Signup errors out and the user never appears in Supabase `auth.users`
This is the priority bug — nothing else can be verified until signup actually creates a user. Likely causes, in rough order of likelihood:
- The Server Action is catching the error from `supabase.auth.signUp()` and returning a generic message instead of surfacing what actually failed
- Turnstile verification is failing silently (client site key may be wired in, but confirm the **secret key** is correctly set in the Supabase dashboard under Auth → Bot and Abuse Protection)
- A misconfigured RLS policy or trigger is erroring on insert
- A missing or misnamed env var at runtime (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

**Action:** reproduce it, then pull the actual server-side error and the Supabase dashboard logs (Auth logs + Postgres logs) before changing any code. Don't guess-fix this one.

### 2. Redirect after signup doesn't land on dashboard
- First confirm which flow is actually intended right now: the step 2 design was "signup → check your email → confirm → then redirect to dashboard," not an immediate redirect. If the current build tries to redirect immediately post-signup, that's a mismatch worth flagging back, not silently fixing either way.
- Check `app/auth/callback/route.ts` — does it actually call `exchangeCodeForSession()` and redirect to `NEXT_PUBLIC_APP_URL`?

### 3. Session doesn't persist on refresh
- Classic symptom of either using the browser client's cookie handling incorrectly, or missing a `middleware.ts` (or `proxy.ts` on Next.js 16+) that refreshes the session cookie on every request.
- Verify `createServerClient` from `@supabase/ssr` is used correctly in Server Components/Actions/Route Handlers with the `cookies()` adapter, and that middleware calls `supabase.auth.getUser()` on each request to keep the cookie fresh.

### 4. Name doesn't show on dashboard
- Tied to bug #1 — if the `profiles` row was never created, there's no `full_name` to show.
- Confirm the dashboard reads the name server-side (from `profiles` or user metadata), not from a stale client-side value.

### 5. Hasn't been tested end-to-end
- Don't do this until 1–4 are fixed. Then run one clean test account through the entire flow.

## Security & session audit checklist

### Secrets — must be 100% server-side
- [ ] `SUPABASE_SERVICE_ROLE_KEY` never appears in any `'use client'` file, never reaches the browser, never has a `NEXT_PUBLIC_` prefix
- [ ] Grep the codebase for `SERVICE_ROLE` and confirm every usage is server-only
- [ ] Turnstile secret key is only referenced server-side (or lives only in the Supabase dashboard config, not app code)
- [ ] `.env.local` is gitignored and has never been committed — check git history, not just the current `.gitignore`
- [ ] `.env.local.example` lists variable names only, no real values

### Session handling
- [ ] Cookie-based sessions via `@supabase/ssr` (`httpOnly`, `secure`, `sameSite`) — not `localStorage`
- [ ] `middleware.ts` (or `proxy.ts` on Next 16+) refreshes the session on every request
- [ ] `/dashboard` is protected server-side — an unauthenticated visit redirects to `/signin` via `supabase.auth.getUser()` checked in middleware or a Server Component, not a client-side-only check
- [ ] Logout button triggers a Server Action that calls `supabase.auth.signOut()` server-side and clears the cookie, then redirects — not just clearing client state

### Signup flow
- [ ] `supabase.auth.signUp()` is only ever called from a Server Action, never client-side
- [ ] Server-side Zod validation exists (client-side validation is UX only, not the boundary)
- [ ] Turnstile token is verified before Supabase accepts the signup
- [ ] Errors returned to the client are generic — no "email already exists" enumeration leak
- [ ] The `profiles` row is created only by the Postgres trigger on `email_confirmed_at` transition — never by application code

### Sign-in flow
- [ ] `supabase.auth.signInWithPassword()` is only ever called from a Server Action, never client-side
- [ ] Same generic-error treatment — don't reveal whether the email exists or the password was wrong
- [ ] Rate limiting applies to sign-in attempts too, not just signup (brute-force protection)

### RLS
- [ ] RLS is enabled on `profiles` (and any other user data table)
- [ ] Default-deny, with an explicit policy restricting select/update to `auth.uid() = id`
- [ ] Manually verify: with a real logged-in session, try to query another user's row directly — it should return nothing

### Rate limiting (currently a TODO — decide now)
- [ ] Pick an approach — Upstash Redis is the recommended default for serverless/Vercel; don't fall back to in-memory, it won't work across instances
- [ ] Apply it to both the signup and signin Server Actions
- [ ] Return 429 with a generic message on exceed, no enumeration hints

## Deliverable

A written report — not just a diff — covering:
1. The actual root cause of the "no user in Supabase" error, with the real error message found
2. What was fixed for each of the 4 reported bugs, and why
3. Pass/fail on every checklist item above, with file/line references
4. The rate limiting approach chosen and implemented
5. Confirmation that this full loop works cleanly on localhost: signup → confirm email → dashboard shows name → refresh keeps session → logout clears session → visiting `/dashboard` while logged out redirects to `/signin`

## Out of scope for this pass

Password reset, social auth, and subdomain/domain wiring — all still deferred until the domain is purchased.