import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { order_ids, agent_id } = body;
  if (!Array.isArray(order_ids) || order_ids.length === 0 || !agent_id) {
    return NextResponse.json({ error: "Missing required fields: order_ids and agent_id" }, { status: 400 });
  }
  const actorMarketId = actor.market_id ?? "";

  if (!canAssignOrders(role, actorMarketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pre-validate agent's market
  const { data: agent } = await supabase
    .from("users")
    .select("id, market_id")
    .eq("id", agent_id as string)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (role !== "super_admin" && agent.market_id !== actorMarketId) {
    return NextResponse.json(
      { error: "Agent market does not match your market" },
      { status: 400 }
    );
  }

  // Verify ALL orders belong to actor's market before assigning any
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, market_id, status")
    .in("id", order_ids as string[]);

  if (ordersError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (role !== "super_admin") {
    const wrongMarket = (orders ?? []).find(
      (o: { market_id: string }) => o.market_id !== actorMarketId
    );
    if (wrongMarket) {
      return NextResponse.json(
        { error: "All orders must belong to your market" },
        { status: 400 }
      );
    }
  }

  // Atomic bulk assignment — all or nothing via RPC
  const { data: rpcResult, error: rpcError } = await supabase.rpc("bulk_assign_orders", {
    p_order_ids: order_ids as string[],
    p_agent_id: agent_id as string,
    p_actor_id: actor.id,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      assigned: (rpcResult as { assigned: number })?.assigned ?? order_ids.length,
      skipped: 0,
      errors: [],
    },
  });
}
