import { NextRequest, NextResponse } from "next/server";
import { adminReader, ISO_DATE, NO_STORE } from "@/lib/investors/admin-route";
import { previewSettlements } from "@/lib/investors/settlement-preview";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

/** Body: { deal_ids?: string[], investor_id?: string, period_end: 'YYYY-MM-DD' } → drafts + warnings, nothing written. */
export async function POST(req: NextRequest) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  let b: { deal_ids?: unknown; investor_id?: unknown; period_end?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const periodEnd = String(b.period_end ?? "");
  if (!ISO_DATE.test(periodEnd)) return NextResponse.json({ error: "period_end must be YYYY-MM-DD" }, { status: 400 });
  let dealIds: string[] = Array.isArray(b.deal_ids) ? b.deal_ids.filter((x): x is string => typeof x === "string") : [];
  if (!dealIds.length && typeof b.investor_id === "string") {
    let q = g.admin.from("investor_deals").select("id").eq("investor_id", b.investor_id).neq("status", "closed");
    if (g.actor.role === "market_manager") q = q.eq("market_id", g.actor.market_id ?? "");
    dealIds = (await fetchAllRows<{ id: string }>(q)).map((d) => d.id);
  }
  if (!dealIds.length) return NextResponse.json({ error: "deal_ids or investor_id required" }, { status: 400 });
  try {
    const { drafts } = await previewSettlements(g.admin, dealIds, periodEnd);
    const total = drafts.reduce((a, d) => a + (d.error ? 0 : d.payable), 0);
    return NextResponse.json({ data: drafts, total_payable: total, period_end: periodEnd }, { headers: NO_STORE });
  } catch (e) {
    console.error("[POST settlements/preview]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
