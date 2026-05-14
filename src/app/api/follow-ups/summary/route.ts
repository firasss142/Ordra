import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { getFollowUpsSummary } from "@/lib/follow-ups/summary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Warehouse agents have no view on follow-ups; agents are handled via their
  // own queue and shouldn't be hitting this endpoint directly, but if they do
  // RLS still scopes results to their own confirming_agent_id.
  if (actor.role === "warehouse_agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorMarketId = actor.market_id ?? null;
  const marketParam = req.nextUrl.searchParams.get("market_id");
  const agentParam = req.nextUrl.searchParams.get("agent_id");
  const campaignParam = req.nextUrl.searchParams.get("campaign_id");

  // Market scoping: super_admin can filter by any market (or "all" = null);
  // everyone else is pinned to their own market.
  const marketId =
    actor.role === "super_admin"
      ? marketParam && marketParam !== "all"
        ? marketParam
        : null
      : actorMarketId;

  // Agent filter: managers/super_admins can filter; agents are hard-scoped.
  const agentId =
    actor.role === "agent"
      ? actor.id
      : agentParam && agentParam.length > 0
        ? agentParam
        : null;

  const campaignId = campaignParam && campaignParam.length > 0 ? campaignParam : null;

  const supabase = await createClient();
  const summary = await getFollowUpsSummary(supabase, {
    marketId,
    agentId,
    campaignId,
  });

  return NextResponse.json(
    { data: summary },
    { headers: { "Cache-Control": "private, max-age=2" } },
  );
}
