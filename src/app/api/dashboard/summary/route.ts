import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { getDashboardSummary } from "@/lib/dashboard/summary";
import { todayISO } from "@/lib/date";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent" || actor.role === "warehouse_agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromDate = req.nextUrl.searchParams.get("from_date") ?? todayISO();
  const toDate = req.nextUrl.searchParams.get("to_date") ?? todayISO();
  const marketIdParam = req.nextUrl.searchParams.get("market_id");

  const summary = await getDashboardSummary({
    fromDate,
    toDate,
    marketId: actor.role === "super_admin" ? marketIdParam ?? "all" : null,
    role: actor.role,
    actorMarketId: actor.market_id,
  });

  if (actor.role !== "super_admin") {
    summary.kpis.revenue = null;
    summary.kpis.netProfit = null;
    summary.footer.adSpend = null;
    summary.markets = [];
    summary.topProducts = summary.topProducts.map((p) => ({ ...p, revenue: null }));
  }

  return NextResponse.json(
    { data: summary },
    { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=55" } },
  );
}
