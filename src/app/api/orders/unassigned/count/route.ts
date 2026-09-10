import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import { whereUnassigned } from "@/lib/orders/unassigned";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  if (!canAssignOrders(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase.from("orders").select("*", { count: "exact", head: true });
  if (marketId) query = query.eq("market_id", marketId);

  // Same predicate as the orders KPI tile. The tile now counts through
  // get_orders_kpi_counts, whose `unassigned` filter is this predicate copied
  // verbatim into SQL — so the definition lives in two places again and they
  // MUST be changed together. Kept as its own head-count on purpose: routing
  // this badge through the KPI RPC would compute six counts it throws away.
  // They drifted once and reported 9 versus 188 for the same word.
  const { count, error } = await whereUnassigned(query);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ count: count ?? 0 });
}
