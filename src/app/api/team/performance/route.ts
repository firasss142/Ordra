import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveTeamMarket } from "@/lib/team/api-market";
import { todayIn } from "@/lib/team/room/time";
import { parsePeriodKind, resolvePeriod } from "@/lib/team/performance/period";
import { normalizeFacts } from "@/lib/team/performance/facts";
import { buildView } from "@/lib/team/performance/build";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/performance?market_id=…&period=30d|7d|month|custom[&from=…&to=…]
 * Performance › Équipe (prototypes/team-performance-v3.html): the window and the
 * one before it read in one RPC (`get_team_performance_v2`), every block of the
 * page computed here by lib/team/performance/build.ts.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveTeamMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const sp = req.nextUrl.searchParams;
  const w = resolvePeriod(parsePeriodKind(sp.get("period")), todayIn(scope.tz), sp.get("from"), sp.get("to"));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_team_performance_v2", {
    p_market_id: scope.marketId,
    p_from: w.from,
    p_to: w.to,
    p_tz: scope.tz,
    p_prev_from: w.pfrom,
    p_prev_to: w.pto,
  });
  if (error) {
    console.error("[api/team/performance] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json(buildView(normalizeFacts(data), w), {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
  });
}

export const GET = withRouteErrors("/api/team/performance", "GET", handleGET);
