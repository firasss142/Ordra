import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { reassignOrder, returnToPool } from "@/lib/orders/assignment";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Only managers and super_admins can reassign
  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify order exists and market scope
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!canAssignOrders(role, order.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetAgentId = body.target_agent_id as string | null;

  try {
    if (targetAgentId === null || targetAgentId === undefined) {
      // Return to pool
      const result = await returnToPool(supabase, id, actor.id);
      return NextResponse.json({ data: result });
    } else {
      // Reassign to agent — validate agent market
      const { data: agent } = await supabase
        .from("users")
        .select("id, market_id")
        .eq("id", targetAgentId)
        .single();

      if (!agent) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }

      if (agent.market_id !== order.market_id) {
        return NextResponse.json(
          { error: "Agent market does not match order market" },
          { status: 400 }
        );
      }

      const result = await reassignOrder(supabase, id, targetAgentId, actor.id);
      return NextResponse.json({ data: result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reassignment failed";
    if (message.includes("Cannot return to pool")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
