import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/server";
import { lockedResponse } from "@/lib/orders/order-lock-response";
import { asOrderLockedError } from "@/lib/orders/order-lock";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Settled: moving these would only move a commission. */
const SETTLED = new Set(["delivered", "returned", "cancelled", "deleted"]);

/**
 * POST /api/agent/orders/[id]/take — an agent takes over an order of their market they found in
 * the search (owner, 2026-10-05: « another agent should be able to act on it just like the
 * assigned owner »). The order moves to the agent's list through `assign_order`, the same RPC
 * managers reassign with, so the history says who took it and the previous owner's queue is told
 * by the realtime reassignment event. RLS is not widened: agents still write only their own orders.
 *
 * The presence guard still holds: if the owner has the order open right now, the RPC refuses
 * (409 « locked ») and the agent is told who.
 */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;
  if (actor.role !== "agent" || !actor.market_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!UUID.test(id)) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id, market_id, status, assigned_to").eq("id", id).maybeSingle();
  const o = order as { id: string; market_id: string; status: string; assigned_to: string | null } | null;
  if (!o || o.market_id !== actor.market_id) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (SETTLED.has(o.status)) return NextResponse.json({ error: "settled", code: "settled" }, { status: 409 });
  if (o.assigned_to === actor.id) return NextResponse.json({ data: { order_id: id, assigned_to: actor.id } });

  const { data, error } = await admin.rpc("assign_order", {
    p_order_id: id,
    p_agent_id: actor.id,
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: "Pris en charge par l'agent (recherche)",
  });
  if (error) {
    const locked = lockedResponse(asOrderLockedError(error) ?? error);
    if (locked) return locked;
    return NextResponse.json({ error: "Take over failed" }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export const POST = withRouteErrors("/api/agent/orders/[id]/take", "POST", handlePOST);
