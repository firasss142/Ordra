import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateTransition } from "@/lib/order-engine";
import type { OrderStatus } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";
import {
  actorTypeFor,
  loadTakeOverContext,
  logManagerTakeOver,
  type ManagerActor,
} from "@/lib/orders/manager-takeover";

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

  if (role !== "agent" && role !== "market_manager" && role !== "super_admin") {
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

  const isManager = role !== "agent";

  if (isManager) {
    const ctx = await loadTakeOverContext(
      supabase,
      id,
      actor as ManagerActor,
    );
    if ("error" in ctx) {
      const status =
        ctx.error === "not_found" ? 404 : ctx.error === "forbidden" ? 403 : 400;
      const message =
        ctx.error === "terminal"
          ? "Order is in a terminal status"
          : ctx.error === "forbidden"
          ? "Forbidden"
          : "Order not found";
      return NextResponse.json({ error: message }, { status });
    }

    const { data: orderRow } = await supabase
      .from("orders")
      .select("status")
      .eq("id", id)
      .single();

    if (!orderRow) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const validation = validateTransition(
      orderRow.status as OrderStatus,
      "callback_scheduled",
    );
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    await logManagerTakeOver(supabase, {
      orderId: id,
      orderStatus: orderRow.status,
      actor: actor as ManagerActor,
      originalAgentId: ctx.originalAgentId,
      originalAgentName: ctx.originalAgentName,
    });

    const { error: rpcError } = await supabase.rpc("transition_order_status", {
      p_order_id: id,
      p_new_status: "callback_scheduled",
      p_actor_id: actor.id,
      p_actor_type: actorTypeFor(role),
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

  // Agent path (unchanged)
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
