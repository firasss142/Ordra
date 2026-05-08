import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "market_manager" && actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const marketId =
    actor.role === "super_admin"
      ? (searchParams.get("market_id") ?? null)
      : (actor.market_id ?? null);

  const { data, error } = await supabase.rpc("follow_ups_overdue_by_agent", {
    p_market_id: marketId,
  });

  if (error) {
    console.error("[GET /api/follow-ups/overdue-by-agent]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
