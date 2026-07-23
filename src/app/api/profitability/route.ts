import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { loadProfitabilitySummary } from "@/lib/profitability/load-summary";
import { calculateCPA, calculateCPL } from "@/lib/calculations/acquisition";
import { computePreviousPeriod } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");
  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: "from_date and to_date query parameters are required" },
      { status: 400 },
    );
  }

  let marketId: string;
  if (actor.role === "super_admin") {
    const paramMarketId = req.nextUrl.searchParams.get("market_id");
    if (!paramMarketId) {
      return NextResponse.json(
        { error: "market_id query parameter required for super_admin" },
        { status: 400 },
      );
    }
    marketId = paramMarketId;
  } else {
    marketId = actor.market_id ?? "";
  }

  const includePrevious =
    req.nextUrl.searchParams.get("include_previous") !== "false";

  const previousPeriod = includePrevious
    ? (req.nextUrl.searchParams.get("previous_from_date") &&
      req.nextUrl.searchParams.get("previous_to_date")
        ? {
            from_date: req.nextUrl.searchParams.get("previous_from_date")!,
            to_date: req.nextUrl.searchParams.get("previous_to_date")!,
          }
        : computePreviousPeriod(fromDate, toDate))
    : null;

  const [summary, previousSummary] = await Promise.all([
    loadProfitabilitySummary(supabase, marketId, fromDate, toDate),
    previousPeriod
      ? loadProfitabilitySummary(
          supabase,
          marketId,
          previousPeriod.from_date,
          previousPeriod.to_date,
        )
      : Promise.resolve(null),
  ]);

  const cpa = calculateCPA(summary.ad_spend, summary.confirmed_count);
  const cpl = calculateCPL(summary.ad_spend, summary.leads_count);

  return NextResponse.json({
    data: {
      ...summary,
      cpa,
      cpl,
      previous: previousSummary
        ? {
            revenue: previousSummary.revenue,
            net_profit: previousSummary.net_profit,
            margin: previousSummary.margin,
            ad_spend: previousSummary.ad_spend,
            confirmed_count: previousSummary.confirmed_count,
            delivered_count: previousSummary.delivered_count,
            leads_count: previousSummary.leads_count,
            cpa: calculateCPA(previousSummary.ad_spend, previousSummary.confirmed_count),
            cpl: calculateCPL(previousSummary.ad_spend, previousSummary.leads_count),
            period: previousPeriod,
          }
        : null,
    },
  });
}
