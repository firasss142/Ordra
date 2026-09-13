import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import type { DeliveryScorecard } from "@/lib/delivery/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/scorecard — the agent's own 30-day delivery card.
 * No agent parameter is honoured: the id is always the caller's, and the RPC is
 * SECURITY INVOKER, so RLS would hide anyone else's orders regardless.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_delivery_agent_scorecard", {
    p_agent_id: actor.id,
    p_days: 30,
  });
  if (error) {
    console.error("[api/delivery/scorecard] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: data as DeliveryScorecard });
}
