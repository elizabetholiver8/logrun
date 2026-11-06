import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../db";
import { athletes } from "../../../db/schema";
import { loadPlan, previewPlan, type PlanView } from "../../../lib/plan-data";
import { planToCsv, planToIcs } from "../../../lib/plan-export";
import { parsePlanForm } from "../../../lib/plan-form";
import { getSession } from "../../../lib/session";
import { unitsFromPreference, type Units } from "../../../lib/units";

/**
 * Plan downloads.
 *  GET  /plan/export?format=csv|ics   the athlete's saved plan
 *  POST /plan/export?format=csv|ics   the plan form, regenerated and streamed
 *       without saving, so a preview can be downloaded too
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const [view, units] = await Promise.all([loadPlan(session.athleteId), loadUnits(session.athleteId)]);
  if (!view) return NextResponse.json({ error: "no_plan" }, { status: 404 });
  return respond(view, units, new URL(req.url).searchParams.get("format"));
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const units = await loadUnits(session.athleteId);
  const form = await req.formData();
  const parsed = await parsePlanForm(form, units, new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { view } = await previewPlan({ ...parsed.args, athleteId: session.athleteId });
  return respond(view, units, new URL(req.url).searchParams.get("format"));
}

async function loadUnits(athleteId: number): Promise<Units> {
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, athleteId) });
  return unitsFromPreference(athlete?.measurementPreference);
}

function respond(view: PlanView, units: Units, format: string | null) {
  const name = `logrun-${view.goal}-plan-${view.plan.raceDate}`;
  if (format === "ics") {
    return new NextResponse(planToIcs(view, units), {
      headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${name}.ics"` },
    });
  }
  if (format === "csv") {
    return new NextResponse(planToCsv(view, units), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` },
    });
  }
  return NextResponse.json({ error: "format must be csv or ics" }, { status: 400 });
}
