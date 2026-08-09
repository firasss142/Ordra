import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { resolveDarbAny } from "@/lib/carriers/darb-assabil-areas";
import { recommendCarrierForOrder } from "@/lib/carriers/recommend-carrier-for-order";

export const dynamic = "force-dynamic";

/**
 * GET /api/carriers/rates?order_id=<uuid>
 *
 * Per-carrier delivery price for ONE order's destination, plus which account is
 * cheapest. Feeds the price badge in both carrier pickers.
 *
 * ORDER-SCOPED, not (city, area)-scoped, for two reasons: the server already
 * knows the destination so the client cannot shop for a cheaper city, and the
 * same ownership rules as GET /api/orders/[id] apply for free.
 *
 * A SEPARATE route from GET /api/carriers on purpose — that one is
 * order-independent, cached hard by both pickers, and also serves the carrier
 * settings page, where a per-order price would be meaningless.
 *
 * Non-Libya markets get an empty payload, so the pickers render exactly as before.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const orderId = req.nextUrl.searchParams.get("order_id");
  if (!orderId) {
    return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, market_id, assigned_to, customer_city, darb_destination_id")
    .eq("id", orderId)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!canViewOrders(actor.role, order.market_id, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Agents only see their own queue — mirrors GET /api/orders/[id].
  if (actor.role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const admin = createAdminClient();

  // Resolve the destination the SAME way the dispatch modal does, so the badge
  // matches the price the order will actually ship at. A persisted
  // darb_destination_id (set at intake) is authoritative; otherwise fall back
  // to resolving the stored city string.
  let city: string | null = null;
  let area: string | null = null;

  if (order.darb_destination_id != null) {
    const { data: dest } = await admin
      .from("darb_destinations")
      .select("city, area")
      .eq("id", order.darb_destination_id)
      .maybeSingle();
    if (dest) {
      city = dest.city as string;
      area = dest.area as string;
    }
  }
  if (city == null) {
    const resolved = resolveDarbAny(order.customer_city);
    if (resolved) {
      city = resolved.city;
      area = resolved.area; // null for a multi-area city — handled downstream
    }
  }

  const recommendation = await recommendCarrierForOrder(admin, {
    market_id: order.market_id,
    city,
    area,
  });

  return NextResponse.json({
    data: {
      recommended_carrier_id: recommendation.carrier_id,
      reason: recommendation.reason,
      city,
      area,
      rates: recommendation.ranked.map((c) => ({
        carrier_id: c.carrierId,
        // null, never 0, when we have no price for this destination.
        quoted_fee: c.quotedFee,
        quote_usable: c.quoteUsable,
        true_cost_per_delivered: c.trueCostPerDelivered,
        effective_cost: c.effectiveCost,
        is_cheapest: c.isCheapest,
      })),
    },
  });
}
