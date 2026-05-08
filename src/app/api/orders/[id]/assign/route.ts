import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { assignOrder, unassignOrder } from "@/lib/orders/assignment";
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

  // Look up order to get its market_id
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const actorMarketId = actor.market_id ?? "";

  if (!canAssignOrders(role, order.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.agent_id === null || body.agent_id === undefined) {
      // Unassign
      const result = await unassignOrder(supabase, id, actor.id);
      return NextResponse.json({ data: result });
    } else {
      // Pre-validate agent's market matches order's market
      const { data: agent } = await supabase
        .from("users")
        .select("id, market_id")
        .eq("id", body.agent_id as string)
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

      // Assign or reassign
      const result = await assignOrder(supabase, id, body.agent_id as string, actor.id);
      return NextResponse.json({ data: result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assignment failed";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("market does not match")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult2 = await getActor(req);
  if ("response" in actorResult2) return actorResult2.response;
  const { actor: actor2 } = actorResult2;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const actorMarketId = actor2.market_id ?? "";

  if (!canAssignOrders(actor2.role, order.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await unassignOrder(supabase, id, actor2.id);
    return NextResponse.json({ data: result });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
