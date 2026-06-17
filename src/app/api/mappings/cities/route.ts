import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewMappings, canManageMappings } from "@/lib/mapping-permissions";
import { marketIdToCode } from "@/lib/markets";

export const dynamic = "force-dynamic";

/**
 * City review surface — per-order destination binding. Market-aware.
 *
 * City resolution at webhook intake is name-only: the storefront city is a
 * value the customer picked from a constrained dropdown that mirrors our
 * destination table, so it either exact-matches or it doesn't. There is no
 * city alias table — an unmatched order is bound directly to an existing
 * destination, one order at a time.
 *
 *   - Tunisia: the destination is an OMS city  -> sets orders.city_id.
 *   - Libya:   Darb Assabil is the primary carrier and resolves most cities at
 *              intake. An order that reaches THIS manual surface is one Darb did
 *              not recognise, so the bind targets the Dexpress fallback (the
 *              broader catalogue) -> sets orders.dexpress_state_id. The Darb and
 *              city_id pointers are cleared (three-way exclusivity).
 *
 * GET  — list the destination options for the target market (the dropdown the
 *        bind UI offers): cities for Tunisia, active dexpress_states for Libya.
 * POST — bind one order ({ order_id, city_id | dexpress_state_id }) to an
 *        existing destination and recompute that order's mapping_status.
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewMappings(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const targetMarketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id")
      : actor.market_id;

  if (actor.role === "market_manager" && !targetMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isDexpressMarket = marketIdToCode(targetMarketId) === "ly";

  if (isDexpressMarket) {
    // Libya — the destination catalogue is active Dexpress states.
    // dexpress_states has a single `name` column (Arabic) — no name_ar.
    const { data, error } = await supabase
      .from("dexpress_states")
      .select("id, name")
      .eq("status", 1)
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  }

  // Tunisia (or super_admin with no market) — the destination catalogue is the
  // market's cities.
  let cityQuery = supabase
    .from("cities")
    .select("id, name, name_ar")
    .order("name", { ascending: true });
  if (targetMarketId) {
    cityQuery = cityQuery.eq("market_id", targetMarketId);
  }
  const { data, error } = await cityQuery;
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageMappings(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  const cityId = typeof body.city_id === "string" ? body.city_id.trim() : "";
  const dexpressStateId =
    typeof body.dexpress_state_id === "number" ? body.dexpress_state_id : null;

  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }
  if (!cityId && dexpressStateId === null) {
    return NextResponse.json(
      { error: "city_id or dexpress_state_id is required" },
      { status: 400 },
    );
  }

  // 1. Load the order — it carries its own market (the authority) and product
  //    state (needed to recompute mapping_status).
  const { data: order } = await supabase
    .from("orders")
    .select("id, market_id, product_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Market isolation: a market_manager may only bind orders in their market.
  if (actor.role !== "super_admin" && order.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only pre-confirmation orders can be bound — once confirmed, the order's
  // destination is locked.
  if (order.status !== "pending" && order.status !== "unverified") {
    return NextResponse.json(
      { error: "Order is past confirmation — its destination is locked" },
      { status: 409 },
    );
  }

  const isDexpressMarket = marketIdToCode(order.market_id) === "ly";

  // 2. Validate the destination against the order's market, and decide the two
  //    mutually-exclusive destination columns to write.
  let bindCityId: string | null = null;
  let bindDexpressStateId: number | null = null;

  if (isDexpressMarket) {
    if (dexpressStateId === null) {
      return NextResponse.json(
        { error: "dexpress_state_id is required for this market" },
        { status: 400 },
      );
    }
    const { data: state } = await supabase
      .from("dexpress_states")
      .select("id")
      .eq("id", dexpressStateId)
      .maybeSingle();
    if (!state) {
      return NextResponse.json({ error: "Dexpress state not found" }, { status: 404 });
    }
    bindDexpressStateId = dexpressStateId;
    bindCityId = null;
  } else {
    if (!cityId) {
      return NextResponse.json(
        { error: "city_id is required for this market" },
        { status: 400 },
      );
    }
    const { data: city } = await supabase
      .from("cities")
      .select("id, market_id")
      .eq("id", cityId)
      .maybeSingle();
    if (!city) {
      return NextResponse.json({ error: "City not found" }, { status: 404 });
    }
    if (city.market_id !== order.market_id) {
      return NextResponse.json(
        { error: "City is not in the target market" },
        { status: 400 },
      );
    }
    bindCityId = cityId;
    bindDexpressStateId = null;
  }

  // 3. Bind the order. The city side is now resolved, so an order whose product
  //    is also resolved becomes 'mapped'; one whose product is still null stays
  //    'needs_review'. Writes the market-appropriate destination column and
  //    clears the other, so the mutual-exclusion invariant on orders holds.
  const nextStatus = order.product_id ? "mapped" : "needs_review";
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      city_id: bindCityId,
      dexpress_state_id: bindDexpressStateId,
      // This manual bind targets the Tunisia city or the Libya Dexpress fallback
      // (the broader catalogue for a city Darb doesn't serve). Always clear the
      // Darb pointer to preserve the three-way destination exclusivity.
      darb_destination_id: null,
      mapping_status: nextStatus,
    })
    .eq("id", order.id);

  if (updateError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      order_id: order.id,
      city_id: bindCityId,
      dexpress_state_id: bindDexpressStateId,
      mapping_status: nextStatus,
    },
  });
}
