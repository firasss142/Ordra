import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveTeamMarket } from "@/lib/team/api-market";
import type { TeamPerformance } from "@/lib/team/types";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/team/performance?market_id=…&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 * Period review — one RPC round-trip (`get_team_performance`), bounded in the
 * market's local days.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveTeamMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const from = req.nextUrl.searchParams.get("from_date");
  const to = req.nextUrl.searchParams.get("to_date");
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) {
    return NextResponse.json({ error: "from_date/to_date must be YYYY-MM-DD with from ≤ to" }, { status: 400 });
  }
  // 92 days is the longest review anyone needs; it also bounds the RPC's work.
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (span > 92) {
    return NextResponse.json({ error: "period too long (max 92 days)" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_team_performance", {
    p_market_id: scope.marketId,
    p_from: from,
    p_to: to,
    p_tz: scope.tz,
  });

  if (error) {
    console.error("[api/team/performance] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: (data ?? {}) as TeamPerformance });
}
