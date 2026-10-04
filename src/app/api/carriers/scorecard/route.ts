import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveScorecardMarket } from "@/lib/carriers/scorecard/api-market";
import { SCORECARD_PERIODS, type Scorecard } from "@/lib/carriers/scorecard/types";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/carriers/scorecard?market_id=…&days=7|30|90
 * The Transporteurs page in one RPC round-trip (`get_carrier_scorecard`).
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveScorecardMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  if (!(SCORECARD_PERIODS as readonly number[]).includes(days)) {
    return NextResponse.json({ error: "days must be 7, 30 or 90" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_carrier_scorecard", {
    p_market_id: scope.marketId,
    p_days: days,
  });

  if (error) {
    console.error("[api/carriers/scorecard] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: (data ?? {}) as Scorecard });
}

export const GET = withRouteErrors("/api/carriers/scorecard", "GET", handleGET);
