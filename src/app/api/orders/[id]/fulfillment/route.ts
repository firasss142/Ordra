import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canUpdateFulfillment } from "@/lib/fulfillment-permissions";
import { applyFulfillmentTransition } from "@/lib/orders/fulfillment";
import type { OrderStatus } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const FULFILLMENT_STATUSES = new Set<string>([
  "deposit",
  "in_transit",
  "to_be_returned",
  "delivered",
  "returned",
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

  if (!canUpdateFulfillment(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newStatus = body.status as string;
  if (!newStatus || !FULFILLMENT_STATUSES.has(newStatus)) {
    return NextResponse.json(
      { error: "status must be one of: deposit, in_transit, to_be_returned, delivered, returned" },
      { status: 400 }
    );
  }

  const isDamaged = body.is_damaged === true;
  if (isDamaged && newStatus !== "returned") {
    return NextResponse.json(
      { error: "is_damaged flag is only valid when transitioning to 'returned'" },
      { status: 400 }
    );
  }

  // Verify order exists and market scope
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (role !== "super_admin" && order.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await applyFulfillmentTransition(
      supabase,
      id,
      newStatus as OrderStatus,
      actor.id,
      {
        isDamaged,
        note: typeof body.note === "string" ? body.note : undefined,
      }
    );

    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transition failed";
    if (message.toLowerCase().includes("invalid transition") || message.toLowerCase().includes("cannot transition")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("stock cannot go below zero")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("Order has no linked product")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
