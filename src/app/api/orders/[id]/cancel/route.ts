import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  canCancelOrder,
  canManuallyDeleteOrderStatus,
} from "@/lib/order-permissions";
import type { OrderStatus } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";
import {
  manualDeleteOrders,
  ManualDeleteCarrierVoidError,
  type ManualDeleteOrderRow,
} from "@/lib/orders/manual-delete";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, market_id, tracking_number, carrier_id")
    .eq("id", id)
    .single<ManualDeleteOrderRow>();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const actorMarketId = actor.market_id ?? "";

  if (!canCancelOrder(role, order.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentStatus = order.status as OrderStatus;
  if (!canManuallyDeleteOrderStatus(currentStatus)) {
    return NextResponse.json(
      { error: `Cannot cancel order with status '${currentStatus}'` },
      { status: 400 },
    );
  }

  let note: string | undefined;
  try {
    const body = await req.json();
    note = body.note as string | undefined;
  } catch {
    // Note is optional.
  }

  try {
    const result = await manualDeleteOrders(supabase, createAdminClient(), {
      orders: [order],
      actorId: actor.id,
      note: note?.trim() || "Order manually deleted",
    });

    return NextResponse.json({
      data: {
        order: { id, status: "deleted" },
        result,
      },
    });
  } catch (err) {
    if (err instanceof ManualDeleteCarrierVoidError) {
      return NextResponse.json(
        { error: err.message, order_id: err.orderId, reason: err.reason },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
