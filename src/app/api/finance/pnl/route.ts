import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { loadProfitabilitySummary } from "@/lib/profitability/load-summary";
import { todayInMarket } from "@/lib/dates/market-day";
import { LY_MARKET_ID } from "@/lib/markets";
import { monthWindows, toPnlMonth } from "@/lib/finance/pnl/months";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/pnl?market_id= — P&L global (prototypes/finances-pnl-v3.html):
 * the twelve closed months and the month in progress, each on the basis
 * « livrées dans le mois ». One summary per month, the same loader the old
 * P&L read, so the figures agree with it day for day.
 */
async function handleGET(req: NextRequest) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewFinanceSection(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) return NextResponse.json({ error: "market_id is required" }, { status: 400 });

  const today = todayInMarket(marketId);
  const windows = monthWindows(today);
  const summaries = await Promise.all(windows.map((w) => loadProfitabilitySummary(supabase, marketId, w.from, w.to)));

  return NextResponse.json({
    today,
    currency: marketId === LY_MARKET_ID ? "LYD" : "TND",
    months: windows.map((w, i) => toPnlMonth(summaries[i], w)),
  });
}

export const GET = withRouteErrors("/api/finance/pnl", "GET", handleGET);
