import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveTeamMarket } from "@/lib/team/api-market";
import type { AgentDayDetail } from "@/lib/team/types";

export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/team/agent-day?market_id=…&agent_id=…&day=YYYY-MM-DD
 * One agent, one market-local day — the payload behind a Présence cell click.
 * One RPC round-trip (`get_agent_day_detail`); market isolation is enforced
 * inside the function, not here.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveTeamMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const agentId = req.nextUrl.searchParams.get("agent_id");
  const day = req.nextUrl.searchParams.get("day");
  if (!agentId || !UUID.test(agentId)) {
    return NextResponse.json({ error: "agent_id must be a UUID" }, { status: 400 });
  }
  if (!day || !ISO_DAY.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_agent_day_detail", {
    p_market_id: scope.marketId,
    p_agent_id: agentId,
    p_day: day,
    p_tz: scope.tz,
  });

  if (error) {
    console.error("[api/team/agent-day] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: (data ?? {}) as AgentDayDetail });
}
