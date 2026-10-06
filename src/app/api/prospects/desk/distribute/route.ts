import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { deskMarket } from "@/lib/prospects/desk/route-market";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/prospects/desk/distribute — « Répartir maintenant ». Runs the
 * daily tick's distribution step at once (prospects_distribute_now): fills
 * every agent's file up to the cap, the agent of the original order first.
 */
async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const body = await req.json().catch(() => ({}));
  const m = deskMarket(actorResult.actor, (body as { market_id?: string }).market_id);
  if ("response" in m) return m.response;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prospects_distribute_now", { p_market_id: m.marketId });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[api/prospects/desk/distribute] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export const POST = withRouteErrors("/api/prospects/desk/distribute", "POST", handlePOST);
