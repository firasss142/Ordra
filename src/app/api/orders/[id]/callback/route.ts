import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateTransition } from "@/lib/order-engine";
import type { OrderStatus } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";

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

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { callback_time: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.callback_time) {
    return NextResponse.json({ error: "callback_time is required" }, { status: 400 });
  }

  const callbackDate = new Date(body.callback_time);
  if (isNaN(callbackDate.getTime())) {
    return NextResponse.json({ error: "callback_time is not a valid timestamp" }, { status: 400 });
  }

  if (callbackDate <= new Date()) {
    return NextResponse.json(
      { error: "callback_time must be in the future" },
      { status: 400 }
    );
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const validation = validateTransition(
    order.status as OrderStatus,
    "callback_scheduled"
  );
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  // Transition via RPC (handles row-level locking, history, callback_scheduled_at)
  const { error: rpcError } = await supabase.rpc("transition_order_status", {
    p_order_id: id,
    p_new_status: "callback_scheduled",
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: `Rappel prévu pour ${new Date(body.callback_time).toLocaleString("fr-TN")}`,
    p_rejection_reason: null,
    p_rejection_note: null,
    p_callback_at: body.callback_time,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: { new_status: "callback_scheduled", callback_time: body.callback_time },
  });
}
