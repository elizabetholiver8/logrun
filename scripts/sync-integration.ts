import { eq, count } from "drizzle-orm";
import { db } from "../src/db";
import { activities, athletes } from "../src/db/schema";
import { storeTokens } from "../src/lib/strava";
import { syncActivities } from "../src/lib/sync";

const ID = 777;
async function main() {
  await db.delete(athletes).where(eq(athletes.id, ID));
  await db.insert(athletes).values({ id: ID, firstName: "Test" });
  await storeTokens(ID, { access_token: "a", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600 });

  const r1 = await syncActivities(ID, { maxPages: 1 });
  console.log("first page:", JSON.stringify({ ...r1, rateLimit: undefined }));
  const r2 = await syncActivities(ID);
  console.log("backfill:", JSON.stringify({ ...r2, rateLimit: undefined }));
  const r3 = await syncActivities(ID);
  console.log("incremental:", JSON.stringify({ ...r3, rateLimit: undefined }));
  const r4 = await syncActivities(ID);
  console.log("re-run (idempotent):", JSON.stringify({ ...r4, rateLimit: undefined }));

  await fetch("http://localhost:4567/_add", { method: "POST" });
  await fetch("http://localhost:4567/_add", { method: "POST" });
  const r5 = await syncActivities(ID);
  console.log("after 2 new runs:", JSON.stringify({ ...r5, rateLimit: undefined }));

  const [{ n }] = await db.select({ n: count() }).from(activities).where(eq(activities.athleteId, ID));
  const a = await db.query.athletes.findFirst({ where: eq(athletes.id, ID) });
  console.log("rows:", n, "backfillCompletedAt:", !!a?.backfillCompletedAt, "newest:", a?.newestActivityAt?.toISOString());
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
