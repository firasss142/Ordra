import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { UUID_RE } from "@/lib/investors/admin-route";
import type { DeliveryBoardResponse } from "@/lib/delivery/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/board — what each agent of a market did today, plus the
 * roster and the market's first-action target.
 *
 * Managers and super_admin only: an agent has no business reading how their
 * colleagues are doing. The RPC is SECURITY INVOKER, so RLS would hide another
 * market's rows regardless of what is asked for here.
 *   market_manager → own market; a market_id parameter is ignored
 *   super_admin    → must name the market
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "market_manager" && actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId || !UUID_RE.test(marketId)) {
    return NextResponse.json({ error: "market_required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_delivery_board", { p_market_id: marketId });
  if (error) {
    console.error("[api/delivery/board] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json(data as DeliveryBoardResponse);
}
