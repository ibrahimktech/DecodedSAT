# DecodedSAT

Free SAT Math, decoded. You miss a question, DecodedSAT names the exact
misconception behind your wrong answer, and hands you a short explainer video
that targets that gap — not another pile of random practice.

**Current phase: landing page only.** No diagnostic engine, question bank, or
auth yet.

## Stack

Next.js (App Router, TypeScript) · Tailwind CSS v4 · Vercel

## Develop

```bash
cp .env.example .env.local   # no real secrets needed for this phase
npm install
npm run dev                  # http://localhost:3000
```

`npm run build` must pass before shipping; the page prerenders fully static.

## Where things live

- [src/app/page.tsx](src/app/page.tsx) — section order, one component per section in [src/components/](src/components/)
- [src/app/globals.css](src/app/globals.css) — the entire design system (Tailwind v4 `@theme`); components never use raw hex
- [src/lib/site.ts](src/lib/site.ts) — copy, link targets, social URLs
- [src/lib/api.ts](src/lib/api.ts) — wrapper future API routes must use (rate limit + validation + CORS + safe errors)
- [CLAUDE.md](CLAUDE.md) — design rules and the security requirements, which apply from the first commit

## Deploy

Push to GitHub, import the repo in Vercel (defaults are fine), point
`decodedsat.com` at the project, and set `NEXT_PUBLIC_SITE_URL=https://decodedsat.com`.
