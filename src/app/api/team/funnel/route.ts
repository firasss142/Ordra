import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveTeamMarket } from "@/lib/team/api-market";
import { ISO_DAY } from "@/lib/commissions/api";
import type { TeamFunnel } from "@/lib/team/room/types";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** A year. The RPC also reads the previous period of the same length. */
const MAX_DAYS = 366;

/**
 * GET /api/team/funnel?market_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD[&prev_from=…&prev_to=…]
 * Orders assigned to each agent in the period → uploaded → delivered, and the
 * previous period for the trend (given, else the same length just before). One
 * RPC (`get_team_funnel`).
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveTeamMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD with from ≤ to" }, { status: 400 });
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_DAYS) {
    return NextResponse.json({ error: `period too long (max ${MAX_DAYS} days)` }, { status: 400 });
  }

  // Optional: the period the trend compares with (a month → the month before).
  // Both or neither; it must end before the period starts.
  const prevFrom = req.nextUrl.searchParams.get("prev_from");
  const prevTo = req.nextUrl.searchParams.get("prev_to");
  if (prevFrom !== null || prevTo !== null) {
    if (!prevFrom || !prevTo || !ISO_DAY.test(prevFrom) || !ISO_DAY.test(prevTo) || prevFrom > prevTo || prevTo >= from) {
      return NextResponse.json({ error: "prev_from/prev_to must be YYYY-MM-DD and end before from" }, { status: 400 });
    }
    if ((Date.parse(prevTo) - Date.parse(prevFrom)) / 86_400_000 + 1 > MAX_DAYS) {
      return NextResponse.json({ error: `previous period too long (max ${MAX_DAYS} days)` }, { status: 400 });
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_team_funnel", {
    p_market_id: scope.marketId,
    p_from: from,
    p_to: to,
    p_tz: scope.tz,
    p_prev_from: prevFrom,
    p_prev_to: prevTo,
  });
  if (error) {
    console.error("[api/team/funnel] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? {}) as TeamFunnel });
}

export const GET = withRouteErrors("/api/team/funnel", "GET", handleGET);
