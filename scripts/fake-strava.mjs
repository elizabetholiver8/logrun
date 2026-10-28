// Fake Strava API for integration testing: N activities, one per day, served
// through /api/v3/athlete/activities with before/after/per_page semantics.
import http from "node:http";
const N = Number(process.env.FAKE_N ?? 450);
const now = Date.parse("2026-10-27T12:00:00Z");
const all = Array.from({ length: N }, (_, i) => {
  const t = now - i * 86400_000;
  return {
    id: 1_000_000 + i, name: `Run ${i}`, sport_type: i % 10 === 9 ? "Ride" : "Run",
    distance: 5000 + i, moving_time: 1500, elapsed_time: 1600, total_elevation_gain: 10,
    start_date: new Date(t).toISOString(), start_date_local: new Date(t - 4 * 3600_000).toISOString(),
    timezone: "(GMT-05:00) America/New_York", average_speed: 3.3, max_speed: 4, map: { summary_polyline: "x" },
  };
});
let calls = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  calls++;
  if (u.pathname === "/_add") {
    const t = now + 86400_000 * (all.filter(a => a.id >= 2_000_000).length + 1);
    all.unshift({ ...all[0], id: 2_000_000 + all.length, name: "New run", sport_type: "Run", start_date: new Date(t).toISOString(), start_date_local: new Date(t).toISOString() });
    res.end("ok"); return;
  }
  if (u.pathname === "/api/v3/athlete/activities") {
    const per = Number(u.searchParams.get("per_page") ?? 30);
    const before = u.searchParams.get("before"); const after = u.searchParams.get("after");
    let rows = all;
    if (before) rows = rows.filter(a => Date.parse(a.start_date) / 1000 < Number(before));
    if (after) rows = rows.filter(a => Date.parse(a.start_date) / 1000 > Number(after)).slice().reverse();
    const page = rows.slice(0, per);
    res.setHeader("content-type", "application/json");
    res.setHeader("x-readratelimit-limit", "200,2000");
    res.setHeader("x-readratelimit-usage", `${calls},${calls}`);
    res.end(JSON.stringify(page));
  } else { res.statusCode = 404; res.end("{}"); }
}).listen(4567, () => console.log("fake strava on 4567"));
