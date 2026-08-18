import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

const LIST_COLS = "id, deal_id, sequence_no, kind, period_start, period_end, currency, revenue, cogs, delivery_cost, return_cost, packing_cost, processing_cost, ad_spend_direct, gross_profit, net_profit, received_count, uploaded_count, delivered_count, returned_count, excluded_dexpress_count, pending_count, share_pct_min, share_pct_max, investor_share, restatement_delta, carried_loss_before, carried_loss_applied, carried_loss_after, payable, cumulative_share_through, capital_amount, settled_at, investor_deals!investor_deal_statements_deal_id_fkey(label, products(name, image_url))";

export async function GET(req: NextRequest) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  try {
    const rows = await fetchAllRows(g.admin.from("investor_deal_statements").select(LIST_COLS).eq("investor_id", g.actor.id).order("period_end", { ascending: false }));
    return NextResponse.json({ data: rows }, { headers: INVESTOR_CACHE });
  } catch (e) {
    console.error("[GET /api/investor/statements]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
