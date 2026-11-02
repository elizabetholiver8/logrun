/**
 * Manage the Strava webhook subscription for this app. One subscription per
 * app; Strava rejects a second create.
 *
 *   npx tsx scripts/strava-webhook.ts view
 *   npx tsx scripts/strava-webhook.ts create https://your-host/api/webhooks/strava
 *   npx tsx scripts/strava-webhook.ts delete <subscription_id>
 *
 * Reads STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_WEBHOOK_VERIFY_TOKEN
 * from .env.local. On create, Strava calls the callback URL's GET handler
 * before answering, so the app must already be deployed with that handler.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const URL_BASE = "https://www.strava.com/api/v3/push_subscriptions";
const clientId = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
if (!clientId || !clientSecret || !verifyToken) {
  console.error("Missing STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET or STRAVA_WEBHOOK_VERIFY_TOKEN");
  process.exit(1);
}

const [cmd, arg] = process.argv.slice(2);

async function show(res: Response) {
  const text = await res.text();
  console.log(res.status, text);
  if (!res.ok) process.exit(1);
}

async function main() {
  switch (cmd) {
    case "view": {
      const q = new URLSearchParams({ client_id: clientId!, client_secret: clientSecret! });
      await show(await fetch(`${URL_BASE}?${q}`));
      return;
    }
    case "create": {
      if (!arg) throw new Error("create needs the callback URL");
      const form = new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        callback_url: arg,
        verify_token: verifyToken!,
      });
      await show(await fetch(URL_BASE, { method: "POST", body: form }));
      return;
    }
    case "delete": {
      if (!arg) throw new Error("delete needs the subscription id");
      const q = new URLSearchParams({ client_id: clientId!, client_secret: clientSecret! });
      await show(await fetch(`${URL_BASE}/${arg}?${q}`, { method: "DELETE" }));
      return;
    }
    default:
      console.error("usage: view | create <callback_url> | delete <id>");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
