import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  canCancelOrder,
  canManuallyDeleteOrderStatus,
} from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import {
  manualDeleteOrders,
  ManualDeleteCarrierVoidError,
  type ManualDeleteOrderRow,
} from "@/lib/orders/manual-delete";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  if (!canCancelOrder(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { order_ids, note } = body;
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return NextResponse.json({ error: "order_ids is required and must be non-empty" }, { status: 400 });
  }
  if (!order_ids.every((id) => typeof id === "string" && id.length > 0)) {
    return NextResponse.json({ error: "order_ids must contain only order ids" }, { status: 400 });
  }
  const orderIds = Array.from(new Set(order_ids as string[]));

  // Verify ownership and manual-delete eligibility before touching carriers or DB state.
  const { data: orders, error: fetchError } = await supabase
    .from("orders")
    .select("id, market_id, status, tracking_number, carrier_id, carrier_extra")
    .in("id", orderIds);

  if (fetchError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const rows = (orders ?? []) as ManualDeleteOrderRow[];
  const foundIds = new Set(rows.map((order) => order.id));
  const missingIds = orderIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return NextResponse.json(
      { error: "Some orders were not found", missing_order_ids: missingIds },
      { status: 404 },
    );
  }

  const forbidden = rows.find(
    (order) => !canCancelOrder(role, order.market_id, actorMarketId),
  );
  if (forbidden) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ineligible = rows.filter((order) => !canManuallyDeleteOrderStatus(order.status));
  if (ineligible.length > 0) {
    return NextResponse.json(
      {
        error: `${ineligible.length} order(s) cannot be manually deleted`,
        ineligible: ineligible.map((order) => ({ id: order.id, status: order.status })),
      },
      { status: 422 },
    );
  }

  try {
    const rpcData = await manualDeleteOrders(supabase, createAdminClient(), {
      orders: rows,
      actorId: actor.id,
      note: typeof note === "string" ? note.trim() || null : null,
    });

    return NextResponse.json({
      data: { deleted: orderIds.length, ...(rpcData && typeof rpcData === "object" ? rpcData : {}) },
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
