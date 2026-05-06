import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canTransitionOrder } from "@/lib/order-permissions";
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

    if (
      !orderRow ||
      !canTransitionOrder(role, orderRow.status as OrderStatus, "confirmed")
    ) {
      return NextResponse.json(
        { error: "Transition not allowed from current status" },
        { status: 400 },
      );
    }

    await logManagerTakeOver(supabase, {
      orderId: id,
      orderStatus: orderRow.status,
      actor: actor as ManagerActor,
      originalAgentId: ctx.originalAgentId,
      originalAgentName: ctx.originalAgentName,
    });

    const { error } = await supabase.rpc("transition_order_status", {
      p_order_id: id,
      p_new_status: "confirmed",
      p_actor_id: actor.id,
      p_actor_type: actorTypeFor(role),
      p_note: "Confirmé par le manager",
      p_rejection_reason: null,
      p_rejection_note: null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    return NextResponse.json({ success: true, new_status: "confirmed" });
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

  if (!canTransitionOrder(role, order.status as OrderStatus, "confirmed")) {
    return NextResponse.json(
      { error: "Transition not allowed from current status" },
      { status: 400 }
    );
  }

  const { error } = await supabase.rpc("transition_order_status", {
    p_order_id: id,
    p_new_status: "confirmed",
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: "Confirmé par l'agent",
    p_rejection_reason: null,
    p_rejection_note: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json({ success: true, new_status: "confirmed" });
}
