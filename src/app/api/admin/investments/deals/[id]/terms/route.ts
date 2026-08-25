import { NextRequest, NextResponse } from "next/server";
import { adminReader, adminWriter, ISO_DATE, NO_STORE, rpcError } from "@/lib/investors/admin-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  const rows = await fetchAllRows(g.admin.from("investor_deal_terms").select("id, effective_from, share_pct, capital_amount, payout_cadence, maturity_date, note, created_by, created_at").eq("deal_id", params.id).order("effective_from", { ascending: true }));
  return NextResponse.json({ data: rows }, { headers: NO_STORE });
}

/** Amend terms with an effective date. Body: { effective_from, share_pct, capital_amount, payout_cadence, maturity_date, note? }. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminWriter(req);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const eff = String(b.effective_from ?? "");
  const mat = String(b.maturity_date ?? "");
  const share = Number(b.share_pct);
  const capital = Number(b.capital_amount);
  const cadence = String(b.payout_cadence ?? "quarterly");
  if (!ISO_DATE.test(eff) || !ISO_DATE.test(mat)) return NextResponse.json({ error: "effective_from and maturity_date must be YYYY-MM-DD" }, { status: 400 });
  if (!Number.isFinite(share) || share <= 0 || share > 100) return NextResponse.json({ error: "share_pct must be in (0, 100]" }, { status: 400 });
  if (!Number.isFinite(capital) || capital < 0) return NextResponse.json({ error: "capital_amount must be >= 0" }, { status: 400 });
  if (!["monthly", "quarterly", "semiannual", "annual", "at_maturity"].includes(cadence)) return NextResponse.json({ error: "invalid payout_cadence" }, { status: 400 });
  const { data, error } = await g.admin.rpc("amend_investor_deal_terms", {
    p_deal_id: params.id, p_effective_from: eff, p_share_pct: share, p_capital_amount: capital, p_payout_cadence: cadence, p_maturity_date: mat, p_note: typeof b.note === "string" ? b.note : null, p_actor_id: g.actor.id,
  });
  if (error) return rpcError(error, "[POST deals/[id]/terms]");
  return NextResponse.json({ data: { id: data } }, { status: 201 });
}
