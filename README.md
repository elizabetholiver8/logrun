# logrun

Run tracking and training plans built on Strava history. A portfolio project
showing a full stack end to end: OAuth, webhooks, a relational schema, server
rendering, a tested rules engine, CI, and a free-tier deployment.

Live: https://logrun-seven.vercel.app. The welcome page has a read-only demo
with sample data, so no account is needed to look around.

## What it does

- **Strava sync.** Connect with Strava, backfill history page by page within
  Strava's rate limits, then stay current through webhooks for new, edited
  and deleted activities. Tokens are encrypted at rest and refreshed before
  they expire.
- **Dashboard.** Thirty-day totals, weekly distance and pace charts, recent
  runs, and a route map for any run with GPS.
- **Training plans.** A deterministic generator builds a plan to a race date
  from the athlete's own four-week baseline: weekly ramps capped at 10
  percent, a cutback every fourth week, a taper, one long run and one quality
  session per week on the athlete's chosen days, and lifting slots that are
  kept off the day before the long run.
- **Progress tracking.** Each planned day is matched against synced runs at
  read time, so the calendar reflects what was actually done, including runs
  that arrive later by webhook.
- **Demo mode.** A fixed athlete seeded from an anonymized, date-shifted
  export. The session carries a demo flag; the plan builder runs the real
  generator and returns a preview instead of saving, and every other write
  path refuses the flag server side.

## Architecture

```
Browser ── Next.js App Router (React server components, server actions)
              │
              ├─ /auth/*            OAuth with Strava, signed-cookie sessions
              ├─ /api/sync          bounded sync pass, called repeatedly by the client
              ├─ /api/webhooks/*    Strava push events, stored then processed after the response
              ├─ /dashboard /runs   server-rendered from Postgres
              └─ /plan              generator in src/lib/plan.ts, persistence in src/lib/plan-data.ts
              │
         Drizzle ORM ── Postgres (Neon in production, local Postgres for integration tests)
```

- `src/lib/strava.ts`: authorize URL, code exchange, token refresh, rate-limit
  aware fetch.
- `src/lib/sync.ts`: backfill cursor and incremental sync, idempotent upserts
  keyed on Strava's activity ID.
- `src/lib/webhooks.ts`: subscription validation, event parsing, and the
  decision table for create, update, delete and deauthorize.
- `src/lib/plan.ts`: the plan generator. Pure functions, no I/O, so every rule
  has a unit test.
- `src/lib/session.ts`: HMAC-signed stateless sessions. Nothing is stored
  server side.
- `src/lib/crypto.ts`: AES-256-GCM for tokens, keyed from the session secret.

Sessions and tokens never leave the server. The only client-side JavaScript
is the charts, the map, the sync button and the plan form.

## Stack

Next.js 16, React 19, TypeScript, Tailwind 4, Drizzle ORM, Postgres on Neon,
Recharts, Leaflet with OpenStreetMap tiles, Vitest, GitHub Actions, Vercel.

## Local setup

Requirements: Node 24, a Postgres database (Neon free tier or local), and a
Strava API application at https://www.strava.com/settings/api.

```
npm install
cp .env.example .env.local      # then fill in the values
npx drizzle-kit migrate         # creates the tables
npm run dev
```

`.env.local` keys:

| Key | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. A `*.neon.tech` host uses the Neon HTTP driver; anything else uses node-postgres. |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | From your Strava API application. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Any string; Strava echoes it when registering the webhook. |
| `SESSION_SECRET` | 32 random bytes, for example `openssl rand -base64 32`. Signs sessions and derives the token encryption key. |

Strava needs the app's host as its Authorization Callback Domain
(`localhost` for development). Webhooks need a public URL, so they are
registered against the deployed app with `scripts/strava-webhook.ts`.

### Demo data

The demo athlete is seeded from an export of a real account:

```
npx tsx scripts/demo-export.ts <your-athlete-id>     # writes demo-export.json
npx tsx scripts/demo-seed.ts --polylines 20          # seeds the DATABASE_URL in .env.local
```

The export holds GPS tracks, so it is git-ignored. Seeding shifts dates so the
newest run is today; run it again when the demo should look current.

## Checks

```
npm run typecheck
npm test
npx eslint .
npx next build
```

CI runs the same on every push. `npm audit --omit=dev` reports no
vulnerabilities; the moderate findings in `npm audit` are in development-only
tooling (esbuild via drizzle-kit, minimatch via eslint) and do not ship.

## Scripts

See `scripts/README.md` for the fake Strava server, the sync integration
test, webhook management and the demo tooling.
