import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validateTransition } from "@/lib/order-engine";
import type { OrderStatus } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";

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

  if (actor.role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    scheduled_at?: string;
    auto_dispatch?: boolean;
    carrier_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.scheduled_at) {
    return NextResponse.json(
      { error: "scheduled_at is required" },
      { status: 400 }
    );
  }

  const scheduledAt = new Date(body.scheduled_at);
  if (isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { error: "scheduled_at is not a valid timestamp" },
      { status: 400 }
    );
  }

  if (scheduledAt <= new Date()) {
    return NextResponse.json(
      { error: "scheduled_at must be in the future" },
      { status: 400 }
    );
  }

  const autoDispatch = body.auto_dispatch === true;
  const carrierId = body.carrier_id ?? null;

  if (autoDispatch && !carrierId) {
    return NextResponse.json(
      { error: "carrier_id is required when auto_dispatch is true" },
      { status: 400 }
    );
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to, market_id")
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
    "dispatch_scheduled"
  );
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  if (autoDispatch && carrierId) {
    const admin = createAdminClient();
    const { data: carrier, error: carrierError } = await admin
      .from("carriers")
      .select("id, market_id, is_active")
      .eq("id", carrierId)
      .single();

    if (carrierError || !carrier) {
      return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
    }
    if (carrier.market_id !== order.market_id) {
      return NextResponse.json(
        { error: "Carrier does not belong to the order's market" },
        { status: 400 }
      );
    }
    if (!carrier.is_active) {
      return NextResponse.json(
        { error: "Carrier is not active" },
        { status: 400 }
      );
    }
  }

  const note = autoDispatch
    ? `Livraison planifiée (auto) pour ${scheduledAt.toLocaleString("fr-TN")}`
    : `Livraison planifiée pour ${scheduledAt.toLocaleString("fr-TN")}`;

  const { error: rpcError } = await supabase.rpc("transition_order_status", {
    p_order_id: id,
    p_new_status: "dispatch_scheduled",
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: note,
    p_rejection_reason: null,
    p_rejection_note: null,
    p_callback_at: null,
    p_scheduled_at: scheduledAt.toISOString(),
    p_scheduled_auto: autoDispatch,
    p_scheduled_carrier_id: carrierId,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      new_status: "dispatch_scheduled",
      scheduled_at: scheduledAt.toISOString(),
      auto_dispatch: autoDispatch,
      carrier_id: carrierId,
    },
  });
}
