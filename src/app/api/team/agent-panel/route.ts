import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveTeamMarket } from "@/lib/team/api-market";
import { ISO_DAY } from "@/lib/commissions/api";
import type { AgentPanel } from "@/lib/team/room/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The panel shows a day or a week; a month is the most it is ever asked for. */
const MAX_DAYS = 31;

/**
 * GET /api/team/agent-panel?market_id=…&agent_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD
 * One agent over a short period: products, rejection groups, her uploads of
 * the last 30 days, and her commission. One RPC (`get_team_agent_panel`).
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveTeamMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const agentId = req.nextUrl.searchParams.get("agent_id");
  if (!agentId || !UUID.test(agentId)) {
    return NextResponse.json({ error: "agent_id must be a UUID" }, { status: 400 });
  }
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD with from ≤ to" }, { status: 400 });
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_DAYS) {
    return NextResponse.json({ error: `period too long (max ${MAX_DAYS} days)` }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_team_agent_panel", {
    p_market_id: scope.marketId,
    p_agent_id: agentId,
    p_from: from,
    p_to: to,
    p_tz: scope.tz,
  });
  if (error) {
    console.error("[api/team/agent-panel] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // '{}' means the agent is not in a market the caller may read.
  if (!data || !("agent_id" in (data as object))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ data: data as AgentPanel });
}
