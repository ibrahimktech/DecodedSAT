# DecodedSAT analytics

## Data ownership

- **Supabase** is the durable source for answers, correctness, practice/test
  completion, study time, question struggle signals, explanation milestones,
  video milestones, and compact meaningful-session summaries.
- **PostHog** owns page views, journeys, attribution, browser/device/location
  breakdowns, funnels, autocapture, heatmaps, and session replay. No custom
  replay, raw click stream, mouse movement, scroll stream, or per-second video
  event table is stored in Supabase.

The migration is `supabase/migrations/20260905000000_admin_analytics.sql`.
Apply it through the normal Supabase migration workflow before opening
`/admin/analytics`.

## PostHog setup

Create a PostHog project in the region you intend to use and set:

```dotenv
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_PROJECT_ID=
POSTHOG_PERSONAL_API_KEY=
POSTHOG_API_HOST=https://us.posthog.com
```

Use the matching EU hosts for an EU project. The project token is browser-safe.
The personal API key is server-only and should have only `query:read` and
`person:write` permissions. It powers the admin Traffic view and the official
Persons bulk-delete API used to queue deletion of a student's PostHog person,
events, and recordings during account deletion.

Traffic quality groups explicit initial UTM/referrer attribution with signups,
question engagement, and mature-cohort Day-1/Day-7 return rates. PostHog's own
Sessions and Web Analytics views remain the source for deeper per-channel
session-duration and path analysis.

PostHog is initialized once through `AnalyticsProvider`. Authenticated students
are identified by immutable Supabase `user.id`, never by email or username.
Admins are opted out and are never identified. Replay masks every input and all
page text by default because students may be minors. A final browser-side
sanitizer removes query strings and URL fragments (including possible auth
codes) from PostHog URL/referrer properties; attribution uses only the explicit
UTM allowlist.

## Student-only guard

Admin exclusion is defense in depth:

1. `/api/analytics/context` resolves the role with the existing `is_admin()`
   database function.
2. The client tracker does not initialize for an admin and opts out/reset if a
   student identity was previously present in that browser.
3. `/api/analytics/events` verifies the authenticated session and `is_admin()`.
4. `track_student_event()` repeats the `admin_users` check inside Postgres.
5. Every admin aggregation joins against a student set that excludes current
   rows in `admin_users`. PostHog queries also exclude current admin UUIDs.

Do not add direct `posthog.capture` or inserts into analytics tables elsewhere.
Use `trackStudentEvent()` so future events inherit these protections.

## Explainable heuristics

- **Active now:** meaningful activity within five minutes.
- **Skip:** a question was viewed for at least three seconds and left without
  an answer.
- **Likely give-up:** a question was viewed for at least 30 seconds and left
  without an answer.
- **Struggle:** a solve lasted at least two minutes, or an incorrect answer was
  submitted after at least one minute.
- **Retention return:** a question answer, practice action, explanation action,
  or learning-video action on the exact requested calendar day after signup.

These are product signals, not claims about a student's mental state. Rates are
hidden for samples below five; Needs Attention generally requires ten samples.

## Video events

The YouTube player polls locally while playing, but writes only meaningful
milestones: start, 25%, 50%, 75%, completion, abandonment, replay, and seek.
Question explanation links carry a server-validated question/video association,
so general lessons and direct question explanations remain distinct.

## Account deletion

The Settings Danger Zone requires typing `DELETE`. The server derives the user
ID from the authenticated session; no target ID is accepted from the browser.
When PostHog is enabled, deletion of its identifiable person/events/replays is
queued first. The Supabase Admin API then permanently deletes the Auth account, and
existing `ON DELETE CASCADE` relationships remove the profile, progress,
attempts, sessions, reports, and analytics events. The local session and
onboarding cookie are cleared afterward. Admin accounts cannot use this student
deletion action.

`SUPABASE_SERVICE_ROLE_KEY` is required on the server for the Auth deletion and
must never use a `NEXT_PUBLIC_` prefix.

## Manual verification

1. Apply the analytics migration and add PostHog variables locally.
2. As a student, complete onboarding, answer correctly and incorrectly, leave
   one question after 3 seconds and another after 30 seconds, open an
   explanation, watch a linked video past every quartile, and complete it.
3. Confirm the corresponding Supabase milestones and `/admin/analytics` totals.
4. Confirm PostHog shows the page journey and masked replay without form values
   or readable page text.
5. As an admin, repeat question/video activity on both admin and student routes;
   confirm no Supabase event is written and no PostHog capture occurs, and that
   existing base attempts are excluded from every admin aggregate.
6. Open Delete Account, cancel once, then verify a wrong confirmation does not
   delete. With a disposable student, type `DELETE`, confirm Auth/profile rows
   are gone, the session cannot reopen a protected route, and the PostHog person
   is queued for deletion.
