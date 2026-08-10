import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { loadProfitabilitySummary } from "@/lib/profitability/load-summary";
import {
  loadProfitabilityDaily,
  loadCohortFunnel,
} from "@/lib/profitability/load-daily";
import { calculateCPA, calculateCPL } from "@/lib/calculations/acquisition";
import {
  calculateMarginDelta,
  calculatePeriodDelta,
  type PeriodDelta,
} from "@/lib/calculations/deltas";
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

  const [daily, cohort] = await Promise.all([
    loadProfitabilityDaily(supabase, marketId, fromDate, toDate, summary.ad_spend),
    loadCohortFunnel(supabase, marketId, fromDate, toDate),
  ]);

  const cpa = calculateCPA(summary.ad_spend, summary.confirmed_count);
  const cpl = calculateCPL(summary.ad_spend, summary.leads_count);

  const aov = summary.delivered_count > 0 ? summary.revenue / summary.delivered_count : 0;
  const profitPerDelivered =
    summary.delivered_count > 0 ? summary.net_profit / summary.delivered_count : 0;
  const outcomeCount = summary.delivered_count + summary.returned_count;
  const returnRatePct = outcomeCount > 0 ? (summary.returned_count / outcomeCount) * 100 : 0;
  const returnsCostSharePct =
    summary.revenue > 0 ? (summary.return_cost / summary.revenue) * 100 : 0;

  const prevCpa = previousSummary
    ? calculateCPA(previousSummary.ad_spend, previousSummary.confirmed_count)
    : null;
  const prevCpl = previousSummary
    ? calculateCPL(previousSummary.ad_spend, previousSummary.leads_count)
    : null;
  const prevAov =
    previousSummary && previousSummary.delivered_count > 0
      ? previousSummary.revenue / previousSummary.delivered_count
      : 0;

  const deltas: {
    revenue: PeriodDelta;
    net_profit: PeriodDelta;
    margin_pp: number;
    ad_spend: PeriodDelta;
    cpa: PeriodDelta | null;
    cpl: PeriodDelta | null;
    aov: PeriodDelta | null;
  } | null = previousSummary
    ? {
        revenue: calculatePeriodDelta(summary.revenue, previousSummary.revenue),
        net_profit: calculatePeriodDelta(summary.net_profit, previousSummary.net_profit),
        margin_pp: calculateMarginDelta(summary.margin / 100, previousSummary.margin / 100),
        ad_spend: calculatePeriodDelta(summary.ad_spend, previousSummary.ad_spend),
        cpa: cpa != null && prevCpa != null ? calculatePeriodDelta(cpa, prevCpa) : null,
        cpl: cpl != null && prevCpl != null ? calculatePeriodDelta(cpl, prevCpl) : null,
        aov: aov > 0 && prevAov > 0 ? calculatePeriodDelta(aov, prevAov) : null,
      }
    : null;

  return NextResponse.json({
    data: {
      ...summary,
      cpa,
      cpl,
      aov,
      profit_per_delivered: profitPerDelivered,
      return_rate_pct: returnRatePct,
      returns_cost_share_pct: returnsCostSharePct,
      daily,
      cohort,
      deltas,
      previous: previousSummary
        ? {
            revenue: previousSummary.revenue,
            net_profit: previousSummary.net_profit,
            margin: previousSummary.margin,
            ad_spend: previousSummary.ad_spend,
            confirmed_count: previousSummary.confirmed_count,
            delivered_count: previousSummary.delivered_count,
            leads_count: previousSummary.leads_count,
            cpa: prevCpa,
            cpl: prevCpl,
            aov: prevAov,
            period: previousPeriod,
          }
        : null,
    },
  });
}
