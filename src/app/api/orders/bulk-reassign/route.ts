import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { reassignOrder, returnToPool } from "@/lib/orders/assignment";
import { getActor } from "@/lib/auth/actor";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_ids?: unknown; target_agent_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "order_ids must be a non-empty array" }, { status: 400 });
  }

  const targetAgentId = (body.target_agent_id ?? null) as string | null;

  // Verify all orders exist, belong to this market, and actor can assign them
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, market_id")
    .in("id", orderIds);

  if (ordersError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!orders || orders.length !== orderIds.length) {
    return NextResponse.json({ error: "One or more orders not found" }, { status: 404 });
  }

  for (const order of orders) {
    if (!canAssignOrders(role, order.market_id, actorMarketId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // If reassigning to an agent, verify agent market matches
  if (targetAgentId !== null) {
    const { data: agent } = await supabase
      .from("users")
      .select("id, market_id")
      .eq("id", targetAgentId)
      .single();

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    for (const order of orders) {
      if (agent.market_id !== order.market_id) {
        return NextResponse.json(
          { error: "Agent market does not match order market" },
          { status: 400 }
        );
      }
    }
  }

  let reassigned = 0;
  const errors: string[] = [];

  for (const orderId of orderIds) {
    try {
      if (targetAgentId === null) {
        await returnToPool(supabase, orderId, actor.id);
      } else {
        await reassignOrder(supabase, orderId, targetAgentId, actor.id);
      }
      reassigned++;
    } catch {
      errors.push(`Failed for order ${orderId}`);
    }
  }

  if (errors.length > 0 && reassigned === 0) {
    return NextResponse.json({ error: errors[0] }, { status: 400 });
  }

  return NextResponse.json({ success: true, reassigned });
}
