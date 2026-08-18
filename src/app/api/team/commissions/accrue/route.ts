import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { rpcErrorResponse } from "@/lib/commissions/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/commissions/accrue  { market_id? }
 * Runs the accrual sweep by hand (super_admin). The same function pg_cron
 * runs every 15 min — exposed so a stalled schedule never dead-ends.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let marketId: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.market_id === "string" && body.market_id) marketId = body.market_id;
  } catch {
    /* empty body is fine */
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accrue_agent_commissions", { p_market_id: marketId });
  if (error) return rpcErrorResponse("api/team/commissions/accrue", error);
  return NextResponse.json({ data });
}
