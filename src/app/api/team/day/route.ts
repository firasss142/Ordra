import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveTeamMarket } from "@/lib/team/api-market";
import { ISO_DAY } from "@/lib/commissions/api";
import type { TeamDay } from "@/lib/team/room/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/day?market_id=…&day=YYYY-MM-DD
 * Salle de contrôle — one market-local day: every agent's actions, assignments,
 * live queue (today only) and the control-room settings in force. One RPC
 * (`get_team_day`); market isolation is enforced again inside it.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveTeamMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const day = req.nextUrl.searchParams.get("day");
  if (!day || !ISO_DAY.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_team_day", {
    p_market_id: scope.marketId,
    p_day: day,
    p_tz: scope.tz,
  });
  if (error) {
    console.error("[api/team/day] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? {}) as TeamDay });
}
