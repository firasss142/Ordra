import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { getLatestActivityDateCached } from "@/lib/dashboard/latest-activity";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

// Returns the date of the most recent order_history activity for a market, used
// to anchor the dashboard/P&L default period to the latest data instead of
// always to "today" (seed/imported data can end well before today).
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent" || actor.role === "warehouse_agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketIdParam = req.nextUrl.searchParams.get("market_id");
  const marketId =
    actor.role === "super_admin" ? marketIdParam ?? "all" : actor.market_id;

  const date = await getLatestActivityDateCached(marketId);

  return NextResponse.json(
    { data: { latest_activity_date: date } },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } },
  );
}

export const GET = withRouteErrors("/api/dashboard/latest-activity", "GET", handleGET);
