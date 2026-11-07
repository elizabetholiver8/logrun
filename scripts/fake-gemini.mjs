// Fake Gemini for local testing. Answers generateContent with a fixed,
// valid check-in, or with junk when FAKE_GEMINI_MODE=junk, or 429 when
// FAKE_GEMINI_MODE=quota. Point the app at it with
// GEMINI_API_BASE=http://localhost:4568/v1beta.
import http from "node:http";
const mode = process.env.FAKE_GEMINI_MODE ?? "ok";
let last = null;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/_last") { res.end(last ?? ""); return; }
    last = body;
    res.setHeader("content-type", "application/json");
    if (mode === "quota") { res.statusCode = 429; res.end(JSON.stringify({ error: { message: "Resource exhausted" } })); return; }
    const prompt = JSON.parse(body).contents[0].parts[0].text;
    // First upcoming day that is not a long run or rest.
    const upcoming = prompt.split("Coming up")[1] ?? "";
    const tue = [...upcoming.matchAll(/(\d{4}-\d{2}-\d{2}): planned ((?!long run|rest)\S+)/g)][0]?.[1] ?? "2026-11-10";
    const answer = mode === "junk" ? "I think you did great!" : JSON.stringify({
      summary: "You covered most of the planned distance and the long run went to plan, which is the part that matters most for the half. Two easy days were skipped, so the week came in light on aerobic volume. Paces on the runs you did were slightly faster than the easy targets.",
      highlights: ["Long run completed at a controlled pace", "Tempo hit its target range"],
      concerns: ["Two easy runs missed; easy volume is where the base comes from"],
      adjustment: { type: "swap_workout", date: tue, kind: "easy", reason: "After a light week, keep Tuesday easy and let the long run carry the load." },
    });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: "STOP" }] }));
  });
}).listen(4568, () => console.log("fake gemini on 4568, mode", mode));
