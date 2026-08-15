import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveTeamMarket } from "@/lib/team/api-market";
import type { TeamLive } from "@/lib/team/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/live?market_id=…
 * The Salle de contrôle payload — one RPC round-trip (`get_team_live`).
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveTeamMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_team_live", {
    p_market_id: scope.marketId,
    p_tz: scope.tz,
  });

  if (error) {
    console.error("[api/team/live] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: (data ?? {}) as TeamLive });
}
