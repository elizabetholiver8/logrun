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

- `strava-webhook.ts`: view, create or delete this app's Strava webhook
  subscription using the credentials in `.env.local`. The app must already be
  deployed with the webhook GET handler before `create`, because Strava calls
  it during registration.

  ```
  npx tsx scripts/strava-webhook.ts view
  npx tsx scripts/strava-webhook.ts create https://your-host/api/webhooks/strava
  npx tsx scripts/strava-webhook.ts delete <subscription_id>
  ```

- `demo-export.ts`: writes one athlete's runs to `demo-export.json` with only
  distances, times, elevation, start instants, heart rate and the route
  polyline. No names or Strava IDs. The file is git-ignored.

  ```
  npx tsx scripts/demo-export.ts <athleteId>
  ```

- `demo-seed.ts`: wipes and reseeds the demo athlete from that file, dates
  shifted so the newest run is today, generic names, polylines kept on the
  most recent runs only, plus a half-marathon plan that started three weeks
  ago. Safe to run again. Uses `DATABASE_URL` from `.env.local`.

  ```
  npx tsx scripts/demo-seed.ts --file demo-export.json --polylines 20 --tz America/New_York
  ```

- `fake-gemini.mjs`: stands in for Gemini locally. Returns a fixed valid
  check-in, or junk with `FAKE_GEMINI_MODE=junk`, or a 429 with
  `FAKE_GEMINI_MODE=quota`. Run the app with
  `GEMINI_API_BASE=http://localhost:4568/v1beta GEMINI_API_KEY=x`.

  ```
  node scripts/fake-gemini.mjs
  ```
