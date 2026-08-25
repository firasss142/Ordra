import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";
import { loadDealTerms } from "@/lib/investors/load-accrual";
import { loadDealFeed } from "@/lib/investors/feed";

export const dynamic = "force-dynamic";

/** Per-order event feed: date · event · amounts · your share. Cursor-paginated. */
export async function GET(req: NextRequest, { params }: { params: { dealId: string } }) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 40);
  try {
    const { data: deal } = await g.admin
      .from("investor_deals")
      .select("id, product_id, start_date, end_date")
      .eq("id", params.dealId)
      .eq("investor_id", g.actor.id)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const d = deal as { id: string; product_id: string; start_date: string; end_date: string };
    const terms = await loadDealTerms(g.admin, d.id);
    const { events, next_cursor } = await loadDealFeed(g.admin, { productId: d.product_id, startDate: d.start_date, endDate: d.end_date, terms, cursor, limit: Number.isFinite(limit) ? limit : 40 });
    return NextResponse.json({ data: events, next_cursor }, { headers: INVESTOR_CACHE });
  } catch (e) {
    console.error("[GET /api/investor/deals/[dealId]/feed]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
