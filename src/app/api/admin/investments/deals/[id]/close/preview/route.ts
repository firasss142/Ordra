import { NextRequest, NextResponse } from "next/server";
import { adminReader, ISO_DATE, NO_STORE } from "@/lib/investors/admin-route";
import { previewSettlements } from "@/lib/investors/settlement-preview";

export const dynamic = "force-dynamic";

/** Body: { period_end } → the FINAL statement draft (period_end may exceed end_date to let in-flight cohort orders finish). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  let b: { period_end?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const periodEnd = String(b.period_end ?? "");
  if (!ISO_DATE.test(periodEnd)) return NextResponse.json({ error: "period_end must be YYYY-MM-DD" }, { status: 400 });
  const { drafts } = await previewSettlements(g.admin, [params.id], periodEnd, "final");
  if (!drafts.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: drafts[0] }, { headers: NO_STORE });
}
