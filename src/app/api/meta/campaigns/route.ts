import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

/**
 * The synced campaigns, rolled up, with whether anyone has mapped them yet.
 *
 * This is what feeds the "N campaigns, X LYD unmapped" banner and the mapping
 * drawer. Unmapped spend is deliberately not hidden anywhere: it already counts
 * at market level in the P&L, and the banner's job is to say that its
 * attribution is pending, not that its money is missing.
 */

export const dynamic = "force-dynamic";

interface SpendRow {
  external_campaign_id: string | null;
  campaign_name: string | null;
  ad_account_id: string | null;
  product_id: string | null;
  amount: number;
  period_start: string;
  impressions: number | null;
  clicks: number | null;
  platform_results: number | null;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }
  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");

  const adminClient = createAdminClient();

  let query = adminClient
    .from("ad_spend")
    .select(
      "external_campaign_id, campaign_name, ad_account_id, product_id, amount, period_start, impressions, clicks, platform_results",
    )
    .eq("market_id", marketId)
    .eq("is_active", true)
    .eq("source", "meta");

  if (fromDate && toDate) {
    query = query.lte("period_start", toDate).gte("period_end", fromDate);
  }

  // Paginated: synced rows are one per campaign per day, so a quarter of a
  // handful of campaigns already crosses PostgREST's 1000-row cap and a bare
  // select would silently truncate — understating spend, which overstates profit.
  let rows: SpendRow[];
  try {
    rows = await fetchAllRows<SpendRow>(query);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const byCampaign = new Map<
    string,
    {
      external_campaign_id: string;
      campaign_name: string | null;
      ad_account_id: string | null;
      product_id: string | null;
      spend: number;
      impressions: number;
      clicks: number;
      platform_results: number;
      days: number;
      first_day: string;
      last_day: string;
    }
  >();

  for (const r of rows) {
    const id = r.external_campaign_id;
    if (!id) continue;
    const existing = byCampaign.get(id);
    if (!existing) {
      byCampaign.set(id, {
        external_campaign_id: id,
        campaign_name: r.campaign_name,
        ad_account_id: r.ad_account_id,
        product_id: r.product_id,
        spend: Number(r.amount) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        platform_results: Number(r.platform_results) || 0,
        days: 1,
        first_day: r.period_start,
        last_day: r.period_start,
      });
      continue;
    }
    existing.spend += Number(r.amount) || 0;
    existing.impressions += Number(r.impressions) || 0;
    existing.clicks += Number(r.clicks) || 0;
    existing.platform_results += Number(r.platform_results) || 0;
    existing.days += 1;
    if (r.period_start < existing.first_day) existing.first_day = r.period_start;
    if (r.period_start > existing.last_day) existing.last_day = r.period_start;
    // The latest name wins — campaigns get renamed in Ads Manager and the row
    // the operator recognises is the one Meta shows them today.
    if (r.period_start === existing.last_day && r.campaign_name) {
      existing.campaign_name = r.campaign_name;
    }
  }

  const campaigns = [...byCampaign.values()].sort((a, b) => b.spend - a.spend);
  const unmapped = campaigns.filter((c) => c.product_id === null);

  return NextResponse.json({
    data: campaigns,
    meta: {
      unmapped_count: unmapped.length,
      unmapped_spend: unmapped.reduce((sum, c) => sum + c.spend, 0),
    },
  });
}
