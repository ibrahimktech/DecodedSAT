# Step 3 report — audit & harden signup/signin

Date: 2026-08-18 · Branch: `main` · Verified on `localhost:3000` · Nothing committed.

Two independent faults, either of which alone produces the reported symptoms. Both fixed.
Four further security gaps found during the audit, all fixed. One item remains open and needs you.

---

## Root cause 1 — `getClientIp` threw before any Supabase call ran

This is the answer to "signup errors out and no user appears in `auth.users`": no user was created
because **Supabase was never contacted**. The real error, from the dev server's own log:

```
⨯ TypeError: headers.get is not a function
    at getClientIp   (src\lib\rate-limit.ts:265:26)
    at signUpAction  (src\app\auth\signup\actions.ts:57:53)
```

Rate limiting is step 1 of `signUpAction`, ahead of parsing so a flood costs nothing — and also ahead
of the `try` block, so the throw escaped as an unhandled action error and the form showed its generic
message. `logInAction` called the same helper on its own first line, so **sign-in was equally dead**.
That is the real reason "the session doesn't persist": there was never a session to persist.

**Why it threw.** The helper distinguished a `Request` from a `Headers` by testing for a `.headers`
property, on the theory that only `Request` has one:

```ts
const headers = "headers" in source ? source.headers : source;   // wrong on Next 16
```

On Next 16 `headers()` returns a `HeadersAdapter`. It extends `Headers`, but its constructor also
assigns `this.headers` — a Proxy over a *plain object*, with no `.get` on it. The `in` check therefore
passes for the exact case it was written to exclude, and returns something that is not a `Headers`.

**Fix** — test for the interface, not a property name (`src/lib/rate-limit.ts:277`):

```ts
const headers =
  typeof (source as Headers).get === "function"
    ? (source as Headers)
    : (source as Request).headers;
```

**Proof** — both probes against Next's real sealed `HeadersAdapter`:

```
OLD probe | Next headers()  | THREW TypeError: headers.get is not a function
OLD probe | Request         | -> 198.51.100.9
NEW probe | Next headers()  | -> 203.0.113.7
NEW probe | Request         | -> 198.51.100.9
```

## Root cause 2 — the `profiles` migration had never been applied

`supabase/migrations/20260818000000_profiles.sql` existed in the repo but had never reached the
project. Not a stale cache — the `public` schema was empty:

```
GET /rest/v1/profiles  -> 404
{"code":"PGRST205","message":"Could not find the table 'public.profiles' in the schema cache"}
GET /rest/v1/  (OpenAPI) -> tables exposed: (none)
```

No table meant no trigger, no RLS policies and no `full_name` to read, so bug 4 would have survived
the TypeError fix. The table appeared partway through this session; I have no DDL access, so someone
applied it while I was working — **worth confirming it was you and that it ran top to bottom.**

Side effect worth knowing: my first test user was confirmed *before* the table existed and never got a
profile row, because the trigger fires only on the `email_confirmed_at` null→not-null transition,
which had already happened. Any account confirmed before the migration is in that state permanently.

---

## The five reported bugs

| # | Reported | Outcome |
|---|---|---|
| 1 | Signup errors, no user in `auth.users` | **Fixed** — root cause 1 |
| 2 | Redirect after signup doesn't reach the dashboard | **Not a bug** — see below |
| 3 | Session doesn't persist on refresh | **Works** — was a symptom of bug 1 |
| 4 | Name doesn't show on dashboard | **Fixed** — root cause 2 |
| 5 | Not tested end-to-end | **Done** — transcript below |

**1.** The action now runs its full length — rate limit, Zod re-parse, name sanitisation, Supabase call.
Verified by driving the real form with Cloudflare's always-passes test key, isolating our code from the
live challenge. The log went from a TypeError to a clean answer *from Supabase*:

```
[auth] signup failed: captcha_failed (status 400) — captcha protection: request disallowed (invalid-input-response)
```

That rejection is expected and is mine: a test site key cannot match your real secret. It proves the
request travelled the entire path and was answered by Supabase's captcha check.

**2.** Flagged rather than "fixed", as STEP-3 asks. The build already does what step 2 specified:
signup shows "Check your email" and holds no session, because the account is not real until the
confirmation link fires the trigger. The redirect belongs to the callback and is there —
`exchangeCodeForSession()` at `callback/route.ts:105`, `verifyOtp()` at `:114`, then a redirect to
`APP_URL`. Nothing hardcoded. You never saw it because bug 1 stopped the flow one step earlier.

**3.** `src/proxy.ts` was already correct: refreshes on every request, uses `getUser()` rather than
`getSession()` so a forged cookie fails revalidation, and copies refreshed cookies onto redirects.
The cookie itself was tightened — see below.

**4.** The dashboard already read the name server-side after `getUser()`, never from a stale client
value. With the migration live, a confirmed account renders `Hi, Second Student.`

---

## Also found, and fixed

### Session cookie was not `httpOnly`

A failing checklist item. `@supabase/ssr` ships `httpOnly: false` in its defaults and nothing
overrode it, so the session token was readable by any script on the page. The code comments claimed
httpOnly; nothing set it.

```
before  sb-…-auth-token  httpOnly=false  sameSite=Lax
after   sb-…-auth-token  httpOnly=true   sameSite=Lax
```

Safe here precisely because this project has no browser Supabase client and never touches
`document.cookie` — checked before changing it. New shared `AUTH_COOKIE_OPTIONS`
(`src/lib/supabase/cookie-options.ts`) is imported by both client constructors so they cannot drift;
`secure` derives from the site's own scheme, so it is on in production and off on localhost without a
second switch.

### `/auth/callback` had no rate limiting

CLAUDE.md says every endpoint, no exceptions. This one is unauthenticated and makes a network call to
Supabase on every hit — useful for guessing token hashes and for generating load against your own auth
provider. It was the only route handler in the app and had nothing.

Now 20 per IP per 10 minutes, checked before any parsing, returning a real 429 with `Retry-After` and
a body that offers the way back (`src/app/auth/callback/route.ts:36`). Verified:

```
307 ×20 … then 429 429 429 429 429
retry-after: 591 · content-type: text/html
```

### Production would have fallen back to in-memory limits, silently

Without Upstash credentials the limiter dropped to a per-process window and logged a warning. On
serverless that is not a degraded limit but the absence of one — a fresh budget per cold instance —
and it failed silently. Per your decision, production now refuses to start instead
(`src/lib/rate-limit.ts:224`). The check excludes `next build`, so local builds still work without
production credentials. Verified:

```
no creds  → GET /auth/callback  500   (reason in the server log; nothing leaked to the client)
creds set → GET /auth/callback  307   (boots and serves)
```

### Auth error logs rendered as `{}`

STEP-3's first hypothesis was that the action swallowed the real error. Close: it logged one, but
Next's dev logger serialises object arguments to `{}`, so every auth failure read
`[auth] signup failed {}` — the appearance of logging with none of the value. A large part of why this
was hard to pin down. Every auth log site now interpolates a string, with a shared `describeError`
helper (`src/lib/auth/describe-error.ts`) for thrown values. Client responses are unchanged and still
generic.

### Two minor repairs

- `.env.example:25` was mangled — `NEXT_PUBLIC_SUPABASE_URL=` had been glued onto the head of the
  `APP_URL` comment block, so copying the template gave a variable set to a comment. Moved back into
  the Supabase section.
- `src/components/Mission.tsx:19` had a raw apostrophe where the rest of the paragraph uses `&rsquo;`,
  and was the only thing failing `npm run lint`. Out of scope for step 3; fixed anyway as a
  single character against the file's own convention. Say the word and I'll revert it.

---

## Security & session checklist

"Fixed" means the item was failing when I started.

### Secrets

| Item | Status | Evidence |
|---|---|---|
| Service-role key never in a `'use client'` file, never `NEXT_PUBLIC_` | Pass | grep: 2 hits, both prose comments |
| Every `SERVICE_ROLE` usage server-only | Pass | `env.ts:56`, `server.ts:11` — comments only |
| Turnstile secret referenced server-side only | Pass | absent from app code; lives in Supabase |
| `.env.local` gitignored, never committed | Pass | full history scan: no `.env*` ever tracked |
| Template lists names, not real values | Fixed | `.env.example:25` |

### Session handling

| Item | Status | Evidence |
|---|---|---|
| Cookie sessions — `httpOnly`, `secure`, `sameSite` | Fixed | `cookie-options.ts:33` (was `httpOnly=false`) |
| `proxy.ts` refreshes the session each request | Pass | `proxy.ts:66` `getUser()` |
| `/dashboard` protected server-side | Pass | `proxy.ts:68` + `dashboard/page.tsx:36` |
| Logout is a Server Action, clears cookie, redirects | Pass | `auth/actions.ts:21`; verified 0 cookies after |

### Signup

| Item | Status | Evidence |
|---|---|---|
| `signUp()` only from a Server Action | Pass | `signup/actions.ts:95`; no browser client exists |
| Server-side Zod validation | Pass | `signup/actions.ts:70` re-parses the shared schema |
| Turnstile token verified before signup is accepted | Pass | Supabase rejects a bogus token: `captcha_failed` |
| Generic errors, no account-enumeration leak | Pass | `state.ts:47`; `user_already_exists` → "sent" |
| `profiles` row written only by the trigger | Pass | INSERT as a real user → `403` |

### Sign-in

| Item | Status | Evidence |
|---|---|---|
| `signInWithPassword()` only from a Server Action | Pass | `login/actions.ts:106` |
| Same generic-error treatment | Pass | `email_not_confirmed` folded in with bad credentials |
| Rate limiting on sign-in too | Pass | `login/actions.ts:28` (IP) + `:43` (per account) |

### Row Level Security

| Item | Status | Evidence |
|---|---|---|
| RLS enabled on `profiles` | Pass | verified live, not just in the SQL file |
| Default-deny; select/update scoped to `auth.uid() = id` | Pass | migration `:59`, `:66` |
| Cross-user read returns nothing | Pass | transcript below |

### Rate limiting

| Item | Status | Evidence |
|---|---|---|
| Approach chosen, no in-memory fallback in production | Fixed | Upstash + hard production guard |
| Applied to signup and sign-in | Pass | and now `/auth/callback` too |
| 429 with a generic message on exceed | Pass | route: real 429 · actions: `rate_limited` state\* |

\* A Server Action is an RPC, not an HTTP endpoint, and cannot set a 429 status line. The two auth
actions return a `rate_limited` state with a wait time, which the forms render. The tradeoff was
already documented in `src/lib/api.ts`; left as designed.

---

## Rate limiting as implemented

STEP-3 listed this as an unresolved TODO. The code was in fact already written — what was missing was
the production decision, which you made: keep the dev fallback, hard-fail in production.

| Surface | Key | Budget | On exceed |
|---|---|---|---|
| Signup action | IP | 5 / 15 min | `rate_limited` + wait time |
| Sign-in action | IP | 10 / 10 min | `rate_limited` + wait time |
| Sign-in action | SHA-256 of email | 10 / 15 min | `rate_limited` + wait time |
| `/auth/callback` *(new)* | IP | 20 / 10 min | HTTP 429 + `Retry-After` |

Store is Upstash Redis over its REST API, as a sliding-window log run inside one Lua script so the
trim/count/insert sequence is atomic. The second sign-in budget, keyed on a hash of the email, catches
credential stuffing that rotates source IPs — and it is a limit rather than a lockout, so it expires
on its own and needs no support intervention.

**Before deploying:** set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The app will refuse
to serve without them in production, by design.

---

## End-to-end confirmation

Driven in a real browser against `localhost:3000`. Two accounts, both deleted at the end.

```
1. confirmation link → /auth/callback
   landed on: http://localhost:3000/dashboard
   "Hi, Second Student."                          ← trigger + RLS + server-side read

2. session cookie
   sb-…-auth-token  httpOnly=true  sameSite=Lax  path=/
   secure=false (localhost is http; derives to true on https)

3. hard reload            → still /dashboard, still named
4. away and back          → still /dashboard
5. /auth/login while in   → bounced to /dashboard
6. sign out               → /auth/login?signed_out=1 · cookies left: (none)
7. /dashboard signed out  → redirected to /auth/login
```

RLS probed directly with a real logged-in session — user A against user B's row, the check STEP-3 asks
for by hand:

```
as user A
  SELECT all profiles          200  rows=1     (own row only, of 2 in the table)
  SELECT user B by id          200  rows=0
  UPDATE user B's full_name    204  no change  (verified against the table afterwards)
  UPDATE own email             403  no column grant
  UPDATE own full_name         200  allowed, as intended
  INSERT a row                 403  no insert policy — the trigger is the only writer
  DELETE own row               403  no delete policy — cascade from auth.users instead
as anon
  SELECT all profiles          401  permission denied
```

**Cleanup.** Both test users deleted; `auth.users` and `profiles` are both back to 0 rows, which also
confirmed the `on delete cascade`.

**Build health.** `tsc --noEmit` clean, `npm run lint` clean, `npm run build` succeeds — the real check
that no server-only module leaked into a client bundle.

---

## What I could not verify

### One real click through the live Turnstile challenge — needs you

Your widget serves a *Managed* challenge ("Verify you are human" checkbox), and Cloudflare is
specifically built to stop automation from solving it. Headless and real Chrome both render it
correctly and neither is handed a token. That is the product working, not a fault.

Everything around it is confirmed: the widget loads under the CSP, the site key is accepted, and
`localhost` is on the hostname allowlist (a bad key or host throws 110100/110200 — neither appeared).
Supabase enforces the secret correctly, rejecting a bogus token with `captcha_failed`. With a test key
the form submits cleanly all the way to Supabase.

**One unknown remains:** whether the secret in your Supabase dashboard is paired with site key
`0x4AAAAAAET4…`. Sign up once in your own browser to close it. If it fails, the terminal will now name
the reason instead of printing `{}`.

### Email delivery — untested

Confirmation links were minted through the admin API rather than read from an inbox, so no real email
was exercised. Supabase's built-in SMTP is rate-limited to a handful of messages an hour and is not
intended for production; custom SMTP is a step-4 item.

### Two things to decide

- `SUPABASE_SERVICE_ROLE_KEY` sits in `.env.local` but no application code uses it. I used it for this
  audit with your go-ahead. Removing it shrinks the blast radius of a leaked file; keeping it is fine
  if you want it handy for admin scripts.
- Accounts confirmed before the migration landed have no `profiles` row and never will. There are none
  right now, but if you confirmed any by hand earlier, delete and recreate them.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/rate-limit.ts` | `getClientIp` probe fixed; production guard added |
| `src/lib/supabase/cookie-options.ts` | **new** — shared cookie policy, `httpOnly` on |
| `src/lib/auth/describe-error.ts` | **new** — readable one-line error rendering |
| `src/lib/supabase/server.ts` | applies the cookie policy |
| `src/proxy.ts` | applies the same cookie policy |
| `src/app/auth/callback/route.ts` | rate limiting + 429; readable logs |
| `src/app/auth/signup/actions.ts` | readable failure logs |
| `src/app/auth/login/actions.ts` | readable failure logs |
| `src/app/auth/actions.ts` | readable failure logs |
| `.env.example` | mangled line repaired; Upstash note updated |
| `src/components/Mission.tsx` | apostrophe — the only lint error, out of scope |

Nothing is committed. `.env.local` was borrowed for one isolation test and restored byte-for-byte.
