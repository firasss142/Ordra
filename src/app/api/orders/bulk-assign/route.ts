import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

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

  // Bulk assignment: skip-and-report, not all-or-nothing.
  //
  // The RPC wraps each assign_order in a plpgsql EXCEPTION block, so an order
  // an agent currently has open rolls back ALONE and the loop continues. One
  // locked order out of 200 must not cost the manager the other 199.
  const { data: rpcResult, error: rpcError } = await supabase.rpc("bulk_assign_orders", {
    p_order_ids: order_ids as string[],
    p_agent_id: agent_id as string,
    p_actor_id: actor.id,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // The signature did not change, only the JSON shape — and nothing checks that
  // at compile time (there is no generated Supabase types file). Tolerate the
  // legacy `{ assigned: number }` for one release so a route deployed ahead of
  // the migration does not report `undefined`.
  const raw = (rpcResult ?? {}) as { assigned?: unknown; skipped?: unknown };
  const assignedCount = Array.isArray(raw.assigned)
    ? raw.assigned.length
    : typeof raw.assigned === "number"
      ? raw.assigned
      : order_ids.length;
  const skipped = Array.isArray(raw.skipped)
    ? (raw.skipped as Array<{ order_id: string; reason: string; holder_id?: string }>)
    : [];

  return NextResponse.json({
    data: {
      assigned: assignedCount,
      skipped: skipped.length,
      // Named separately from a generic error list so the bulk bar can say
      // "3 verrouillées par un agent" instead of "3 échecs".
      locked: skipped.filter((s) => s.reason === "locked"),
      errors: [],
    },
  });
}
