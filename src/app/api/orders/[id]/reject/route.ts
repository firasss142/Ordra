import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateTransition } from "@/lib/order-engine";
import type { OrderStatus, RejectionReason } from "@/types/order-status";
import { isValidPair, REJECTION_GROUPS } from "@/lib/orders/rejection-taxonomy";
import { getActor } from "@/lib/auth/actor";
import {
  actorTypeFor,
  loadTakeOverContext,
  logManagerTakeOver,
  type ManagerActor,
} from "@/lib/orders/manager-takeover";

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

  if (role !== "agent" && role !== "market_manager" && role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    rejection_reason: string;
    rejection_subreason?: string | null;
    rejection_note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // A group on its own is not an answer. Requiring the pair is what stops the
  // new taxonomy decaying back into the old one, where the vaguest option was
  // always the fastest way to close the sheet.
  if (!isValidPair(body.rejection_reason ?? "", body.rejection_subreason ?? null)) {
    return NextResponse.json(
      {
        error:
          `Invalid rejection reason. Group must be one of: ${REJECTION_GROUPS.join(", ")}` +
          ", with a sub-reason belonging to it (none for 'autre').",
      },
      { status: 400 }
    );
  }

  if (body.rejection_reason === "autre" && !body.rejection_note?.trim()) {
    return NextResponse.json(
      { error: "rejection_note is required when rejection_reason is 'autre'" },
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

    const validation = validateTransition(orderRow.status as OrderStatus, "rejected");
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

    const { error: rejectError } = await supabase.rpc("transition_order_status", {
      p_order_id: id,
      p_new_status: "rejected",
      p_actor_id: actor.id,
      p_actor_type: actorTypeFor(role),
      p_note: body.rejection_note ?? null,
      p_rejection_reason: body.rejection_reason as RejectionReason,
      p_rejection_subreason: body.rejection_subreason ?? null,
      p_rejection_note: body.rejection_note ?? null,
    });

    if (rejectError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ data: { new_status: "rejected" } });
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

  const validation = validateTransition(order.status as OrderStatus, "rejected");
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const { error: rejectError } = await supabase.rpc("transition_order_status", {
    p_order_id: id,
    p_new_status: "rejected",
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: body.rejection_note ?? null,
    p_rejection_reason: body.rejection_reason as RejectionReason,
    p_rejection_subreason: body.rejection_subreason ?? null,
    p_rejection_note: body.rejection_note ?? null,
  });

  if (rejectError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: { new_status: "rejected" } });
}
