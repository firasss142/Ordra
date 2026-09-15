import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectConsole } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import { marketTimezone } from "@/lib/markets";
import { agentLoad, type AgentLoad, type CampaignResult, type ConsoleMetrics } from "@/lib/prospects/console";

export const dynamic = "force-dynamic";

/** What the screen shows when the market has no prospects at all. */
const EMPTY_METRICS: ConsoleMetrics = {
  new_7d: 0,
  new_prev_7d: 0,
  hot_waiting: 0,
  oldest_hot_minutes: null,
  median_first_contact_minutes: null,
  median_first_contact_prev: null,
  converted_30d: 0,
  delivered_30d: 0,
  delivered_revenue_30d: 0,
};

/**
 * GET /api/prospects/console — the manager half of « Prospects »: the four
 * KPIs, campaign results and the agent roster.
 *
 * One RPC rather than four queries. The database is ~130 ms away, so four
 * round trips cost more in latency than the whole console costs to compute
 * (33 ms measured over the Tunisian market's ~1 700 prospects).
 *
 *   market_manager → own market; query parameters are ignored
 *   super_admin    → must name the market
 *   agent          → refused; an agent works their own queue
 *
 * Design: prototypes/prospects-v3.html (manager view).
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectConsole(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId || !UUID_RE.test(marketId)) {
    return NextResponse.json({ error: "market_required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_prospect_console", {
    p_market_id: marketId,
    // "Aujourd'hui" means the market's day: an agent in Tripoli finishing at
    // 01:00 has not started tomorrow's shift.
    p_tz: marketTimezone(marketId),
  });

  if (error) {
    console.error("[api/prospects/console] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const payload = (data ?? {}) as {
    metrics: ConsoleMetrics | null;
    campaigns: CampaignResult[] | null;
    agents: AgentLoad[] | null;
  };

  return NextResponse.json({
    metrics: payload.metrics ?? EMPTY_METRICS,
    campaigns: payload.campaigns ?? [],
    // Ranked once, here, so every surface reading this route agrees on who
    // needs help first and on what each agent's rate is.
    agents: agentLoad(payload.agents ?? []),
    generated_at: new Date().toISOString(),
  });
}
