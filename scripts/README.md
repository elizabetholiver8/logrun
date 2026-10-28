# scripts

Developer tooling, not shipped.

- `fake-strava.mjs`: a stand-in for the Strava API that serves generated
  activities with `before`/`after`/`per_page` semantics and rate-limit headers.
  `POST /_add` appends a new activity. Start it with `node scripts/fake-strava.mjs`.
- `sync-integration.ts`: exercises backfill, resume, completion, idempotency and
  incremental sync against the fake API and a local Postgres. Run with:

  ```
  DATABASE_URL=postgresql://postgres@localhost:5432/logrun \
  STRAVA_API_BASE=http://localhost:4567/api/v3 \
  STRAVA_CLIENT_ID=x STRAVA_CLIENT_SECRET=x STRAVA_WEBHOOK_VERIFY_TOKEN=x SESSION_SECRET=x \
  npx tsx scripts/sync-integration.ts
  ```
