import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");

  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: "from_date and to_date query parameters are required" },
      { status: 400 }
    );
  }

  let marketId: string;
  if (role === "super_admin") {
    const paramMarketId = req.nextUrl.searchParams.get("market_id");
    if (!paramMarketId) {
      return NextResponse.json(
        { error: "market_id query parameter required for super_admin" },
        { status: 400 }
      );
    }
    marketId = paramMarketId;
  } else {
    marketId = actor.market_id ?? "";
  }

  const agentId = req.nextUrl.searchParams.get("agent_id") || null;

  const { data, error } = await supabase.rpc("get_agent_metrics", {
    p_market_id: marketId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_agent_id: agentId,
  });

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? { actioned_count: 0, confirmed_count: 0, confirmation_rate: 0, avg_attempts: 0 },
  });
}
