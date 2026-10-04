import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { SCOPE_COOKIE } from "@/lib/auth/market-scope";
import { isValidScope, marketIdToCode, scopeToMarketId } from "@/lib/markets";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { fetchDayLoopRows, marketToday } from "@/lib/warehouse/day-loop-server";
import { assembleDayLoop, type DayLoopPayload } from "@/lib/warehouse/day-loop-assemble";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

export type TodayResponse =
  | (DayLoopPayload & { siteUnassigned: false; sitePinned: boolean })
  | { siteUnassigned: true };

/**
 * GET /api/warehouse/today — « Aujourd'hui »: the four jobs and their backlog.
 *
 * Replaces the agent shell's 60-second poll of /api/warehouse/summary, which
 * computed a leaderboard, a trend, low stock and more to draw one badge.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  // Same rule as the bench: a super-admin follows the topbar's market, everyone
  // else stays in their own whatever the query says.
  const requestedMarket = req.nextUrl.searchParams.get("market_id");
  const cookieScope = req.cookies.get(SCOPE_COOKIE)?.value;
  const marketId =
    actor.role !== "super_admin"
      ? (actor.market_id ?? null)
      : requestedMarket && requestedMarket !== "all"
        ? requestedMarket
        : isValidScope(cookieScope)
          ? scopeToMarketId(cookieScope)
          : null;

  const site = await resolveSiteFilter(supabase, {
    actor,
    requested: req.nextUrl.searchParams.get("warehouse_id"),
  });

  // No building, no work: the screen explains itself instead of showing both.
  if (site.unassigned) {
    return NextResponse.json({ siteUnassigned: true } satisfies TodayResponse);
  }

  const rows = await fetchDayLoopRows(supabase, { marketId });
  const payload = assembleDayLoop(rows, {
    focus: site.warehouseId,
    today: marketToday(marketId),
    // Building names are place names painted on a wall: Libya reads them in
    // Arabic, as on the stock screen.
    locale: marketIdToCode(marketId) === "ly" ? "ar" : "fr",
    withManagerViews: actor.role !== "warehouse_agent",
  });

  return NextResponse.json(
    { ...payload, siteUnassigned: false, sitePinned: site.pinned } satisfies TodayResponse,
    { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" } },
  );
}

export const GET = withRouteErrors("/api/warehouse/today", "GET", handleGET);
