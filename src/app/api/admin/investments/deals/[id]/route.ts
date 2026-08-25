import { NextRequest, NextResponse } from "next/server";
import { adminReader, adminWriter, NO_STORE, todayFor } from "@/lib/investors/admin-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computeDealAccrualLive, loadDealTerms, type DealRow } from "@/lib/investors/load-accrual";
import { loadDealFeed } from "@/lib/investors/feed";

export const dynamic = "force-dynamic";

/** Deal detail: live accrual (same function as the portal & settlement), terms history, statements, ledger, recent feed. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  const { data: dealRaw } = await g.admin
    .from("investor_deals")
    .select("id, investor_id, product_id, market_id, currency, label, start_date, end_date, status, close_reason, closed_at, note, created_at, products(name, image_url, unit_cogs, packing_cost, default_price), investors(legal_name)")
    .eq("id", params.id)
    .maybeSingle();
  if (!dealRaw) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const deal = dealRaw as unknown as DealRow & { products: Record<string, unknown> | null; investors: { legal_name: string } | null; note: string | null; created_at: string };
  if (g.actor.role === "market_manager" && deal.market_id !== g.actor.market_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const today = todayFor(deal.market_id);
  const [live, terms, statements, ledger, snapshot] = await Promise.all([
    computeDealAccrualLive(g.admin, deal, today, today),
    loadDealTerms(g.admin, deal.id),
    fetchAllRows(g.admin.from("investor_deal_statements").select("*").eq("deal_id", deal.id).order("period_end", { ascending: false })),
    fetchAllRows(g.admin.from("investor_ledger_entries").select("id, entry_type, amount, currency, statement_id, withdrawal_id, note, created_at, created_by").eq("deal_id", deal.id).order("created_at", { ascending: false })),
    g.admin.from("investor_deal_snapshots").select("as_of, facts_watermark, cumulative_share, payable_now").eq("deal_id", deal.id).maybeSingle(),
  ]);
  const feed = await loadDealFeed(g.admin, { productId: deal.product_id, startDate: deal.start_date, endDate: deal.end_date, terms, cursor: null, limit: 25 });

  return NextResponse.json(
    {
      data: {
        deal,
        terms,
        accrual: live.result,
        facts_watermark: live.factsWatermark,
        snapshot: snapshot.data ?? null,
        statements,
        ledger,
        feed: feed.events,
        today,
      },
    },
    { headers: NO_STORE },
  );
}

/** PATCH label / note only — everything else is a terms amendment or a close. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminWriter(req);
  if ("response" in g) return g.response;
  let b: { label?: unknown; note?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: Record<string, string | null> = {};
  if (b.label !== undefined) patch.label = b.label === null ? null : String(b.label).slice(0, 120);
  if (b.note !== undefined) patch.note = b.note === null ? null : String(b.note).slice(0, 2000);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const { data, error } = await g.admin.from("investor_deals").update(patch).eq("id", params.id).select("id, label, note").maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data });
}
