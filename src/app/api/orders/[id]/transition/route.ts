import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canTransitionOrder } from "@/lib/order-permissions";
import { transitionOrderStatus } from "@/lib/orders/transition";
import type { OrderStatus, RejectionReason } from "@/types/order-status";
import { ORDER_STATUSES } from "@/types/order-status";
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newStatus = body.status as string;
  if (!newStatus || !ORDER_STATUSES.includes(newStatus as OrderStatus)) {
    return NextResponse.json({ error: "Missing or invalid status" }, { status: 400 });
  }

  // Get current order status
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, market_id, assigned_to")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Defense-in-depth: agents can only transition orders assigned to them
  if (role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Permission check: role-based transition authorization
  if (!canTransitionOrder(role, order.status as OrderStatus, newStatus as OrderStatus)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorType = role === "agent" ? "agent" : "manager";

  try {
    const result = await transitionOrderStatus(supabase, {
      orderId: id,
      newStatus: newStatus as OrderStatus,
      actorId: actor.id,
      actorType,
      note: body.note as string | undefined,
      rejectionReason: body.rejectionReason as RejectionReason | undefined,
      rejectionNote: body.rejectionNote as string | undefined,
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transition failed";
    if (message.includes("invalid transition")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("rejection_reason is required")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
