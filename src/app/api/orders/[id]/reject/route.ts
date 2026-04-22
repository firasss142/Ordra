import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateTransition } from "@/lib/order-engine";
import { REJECTION_REASONS } from "@/types/order-status";
import type { OrderStatus, RejectionReason } from "@/types/order-status";
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

  let body: { rejection_reason: string; rejection_note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !body.rejection_reason ||
    !(REJECTION_REASONS as readonly string[]).includes(body.rejection_reason)
  ) {
    return NextResponse.json(
      { error: `Invalid rejection_reason. Must be one of: ${REJECTION_REASONS.join(", ")}` },
      { status: 400 }
    );
  }

  if (body.rejection_reason === "autre" && !body.rejection_note?.trim()) {
    return NextResponse.json(
      { error: "rejection_note is required when rejection_reason is 'autre'" },
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
    p_rejection_note: body.rejection_note ?? null,
  });

  if (rejectError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: { new_status: "rejected" } });
}
