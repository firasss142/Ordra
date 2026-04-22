import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canCancelOrder } from "@/lib/order-permissions";
import { transitionOrderStatus } from "@/lib/orders/transition";
import type { OrderStatus } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";

// Statuses that can be cancelled — pre-dispatch only, excluding confirmed
const CANCELLABLE_STATUSES = new Set<OrderStatus>([
  "new",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
]);

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

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, market_id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const actorMarketId = actor.market_id ?? "";

  if (!canCancelOrder(role, order.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentStatus = order.status as OrderStatus;
  if (!CANCELLABLE_STATUSES.has(currentStatus)) {
    return NextResponse.json(
      { error: `Cannot cancel order with status '${currentStatus}'` },
      { status: 400 }
    );
  }

  // Parse optional note from body
  let note: string | undefined;
  try {
    const body = await req.json();
    note = body.note as string | undefined;
  } catch {
    // No body or invalid JSON — note is optional
  }

  try {
    const result = await transitionOrderStatus(supabase, {
      orderId: id,
      newStatus: "cancelled",
      actorId: actor.id,
      actorType: "manager",
      note: note ?? "Order cancelled",
    });

    return NextResponse.json({ data: result });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
