import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canViewOrders,
  canEditOrder,
  EDIT_BLOCKED_STATUSES,
} from "@/lib/order-permissions";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!canViewOrders(role, order.market_id, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Agent can only view orders assigned to them
  if (role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Fetch history + product stock + order_items in parallel
  const [historyRes, productRes, itemsRes] = await Promise.all([
    supabase
      .from("order_history")
      .select("id, status_from, status_to, note, actor_id, actor_type, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
    order.product_id
      ? supabase
          .from("products")
          .select("current_stock")
          .eq("id", order.product_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("order_items")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const history = (historyRes.data ?? []).map((h) => ({
    id: h.id,
    from_status: h.status_from,
    to_status: h.status_to,
    note: h.note,
    actor_id: h.actor_id,
    actor_type: h.actor_type,
    created_at: h.created_at,
  }));

  const product_current_stock = productRes.data?.current_stock ?? null;
  const order_items = itemsRes.data ?? [];

  // Exclude raw_payload (large webhook JSON blob, not needed in the panel)
  const { raw_payload: _, ...orderFields } = order as typeof order & { raw_payload?: unknown };

  return NextResponse.json({ data: { ...orderFields, history, product_current_stock, order_items } });
}

const SIMPLE_PATCHABLE_FIELDS = ["customer_name", "customer_phone", "customer_phone_2", "customer_address", "customer_city", "quantity"] as const;

export async function PATCH(
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
    .select("id, status, assigned_to, market_id, unit_price, quantity, updated_at, product_id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!canEditOrder(role, actor.id, order)) {
    if (EDIT_BLOCKED_STATUSES.has(order.status)) {
      return NextResponse.json(
        { error: "Réouvrez la commande d'abord pour modifier les détails." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Cannot edit this order" }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // Simple text/numeric fields
  for (const field of SIMPLE_PATCHABLE_FIELDS) {
    if (field in body && body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  // customer_phone_2: normalize empty string → null
  if ("customer_phone_2" in body) {
    updates.customer_phone_2 = body.customer_phone_2 === "" ? null : (body.customer_phone_2 ?? null);
  }

  // delivery_fee: validate ≥ 0, recompute total_price from order_items subtotal
  if ("delivery_fee" in body && body.delivery_fee !== undefined) {
    const fee = typeof body.delivery_fee === "string" ? parseFloat(body.delivery_fee) : body.delivery_fee as number;
    if (typeof fee !== "number" || isNaN(fee) || fee < 0) {
      return NextResponse.json({ error: "delivery_fee must be >= 0" }, { status: 400 });
    }
    updates.delivery_fee = fee;
    // Recompute total from current items + new fee
    const { data: items } = await supabase.from("order_items").select("line_total").eq("order_id", id);
    const subtotal = (items ?? []).reduce((sum: number, item: { line_total: number }) => sum + Number(item.line_total), 0);
    updates.total_price = Math.round((subtotal + fee) * 1000) / 1000;
  }

  // Quantity → recalculate total_price from current unit_price
  if ("quantity" in updates) {
    const newQty = updates.quantity as number;
    if (typeof newQty !== "number" || newQty < 1 || !Number.isInteger(newQty)) {
      return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
    }
    updates.total_price = Math.round((order.unit_price as number) * newQty * 1000) / 1000;
  }

  // Product swap
  if ("product_id" in body && body.product_id !== undefined) {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, market_id, name, default_price, current_stock, is_active")
      .eq("id", body.product_id as string)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (product.market_id !== order.market_id) {
      return NextResponse.json({ error: "Product does not belong to this market" }, { status: 409 });
    }
    if (!product.is_active) {
      return NextResponse.json({ error: "Product is not active" }, { status: 409 });
    }
    if (product.current_stock <= 0) {
      return NextResponse.json({ error: "Product is out of stock" }, { status: 409 });
    }

    const productPrice = (product.default_price ?? 0) as number;
    const qty = (updates.quantity as number | undefined) ?? (order.quantity as number);
    updates.product_id = product.id;
    updates.product_name = product.name;
    updates.unit_price = productPrice;
    updates.total_price = Math.round(productPrice * qty * 1000) / 1000;
    // Clear variant when product changes (unless variant_id is also being set)
    if (!("variant_id" in body)) {
      updates.variant_label = null;
    }
  }

  // Variant swap
  if ("variant_id" in body && body.variant_id !== undefined) {
    const { data: variant, error: variantError } = await supabase
      .from("product_variants")
      .select("id, product_id, label, is_active")
      .eq("id", body.variant_id as string)
      .single();

    if (variantError || !variant) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    }

    // Variant must belong to the order's product (or the newly-swapped product)
    const expectedProductId = (updates.product_id as string | undefined) ?? (order.product_id as string);
    if (variant.product_id !== expectedProductId) {
      return NextResponse.json({ error: "Variant does not belong to this product" }, { status: 409 });
    }
    if (!variant.is_active) {
      return NextResponse.json({ error: "Variant is not active" }, { status: 409 });
    }

    updates.variant_label = variant.label;
  }

  // City swap (Tunisia path — cities table)
  if ("city_id" in body && body.city_id !== undefined) {
    const { data: city, error: cityError } = await supabase
      .from("cities")
      .select("id, market_id, name")
      .eq("id", body.city_id as string)
      .single();

    if (cityError || !city) {
      return NextResponse.json({ error: "City not found" }, { status: 404 });
    }
    if (city.market_id !== order.market_id) {
      return NextResponse.json({ error: "City does not belong to this market" }, { status: 409 });
    }

    updates.city_id = city.id;
    updates.customer_city = city.name; // keep text snapshot for back-compat
  }

  // Dexpress state swap (Libya path — dexpress_states table). Writes both the
  // numeric reference (used by dispatch) and the name snapshot (used by UI).
  // Clears city_id so the order doesn't carry both systems' values.
  if ("dexpress_state_id" in body && body.dexpress_state_id !== undefined) {
    const stateId = body.dexpress_state_id;
    if (stateId === null) {
      updates.dexpress_state_id = null;
    } else if (typeof stateId !== "number" || !Number.isInteger(stateId)) {
      return NextResponse.json(
        { error: "dexpress_state_id must be an integer" },
        { status: 400 },
      );
    } else {
      const { data: state, error: stateError } = await supabase
        .from("dexpress_states")
        .select("id, name")
        .eq("id", stateId)
        .single();

      if (stateError || !state) {
        return NextResponse.json({ error: "Destination not found" }, { status: 404 });
      }

      updates.dexpress_state_id = state.id;
      updates.customer_city = state.name;
      updates.city_id = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const changedFields = Object.keys(updates).filter((k) => k !== "updated_at" && k !== "total_price" && k !== "unit_price");
  const note = JSON.stringify(
    changedFields.reduce<Record<string, unknown>>((acc, k) => {
      // Use human-readable snapshot names, not raw UUIDs
      if (k === "product_id") acc["product"] = updates.product_name;
      else if (k === "variant_id") acc["variant"] = updates.variant_label;
      else if (k === "city_id") acc["city"] = updates.customer_city;
      else if (k === "dexpress_state_id") acc["city"] = updates.customer_city;
      else acc[k] = updates[k];
      return acc;
    }, {}),
  );

  const [{ error: updateError }] = await Promise.all([
    supabase.from("orders").update(updates).eq("id", id),
    supabase.from("order_history").insert({
      order_id: id,
      status_from: order.status,
      status_to: order.status,
      actor_id: actor.id,
      actor_type: role === "agent" ? "agent" : "manager",
      note,
    }),
  ]);

  if (updateError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const [{ data: updatedOrder }, { data: historyRows }, { data: patchedItems }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).single(),
    supabase
      .from("order_history")
      .select("id, status_from, status_to, note, actor_id, actor_type, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("order_items").select("*").eq("order_id", id).order("created_at", { ascending: true }),
  ]);

  const patchHistory = (historyRows ?? []).map((h) => ({
    id: h.id,
    from_status: h.status_from,
    to_status: h.status_to,
    note: h.note,
    actor_id: h.actor_id,
    actor_type: h.actor_type,
    created_at: h.created_at,
  }));

  if (!updatedOrder) {
    return NextResponse.json({ error: "Order not found after update" }, { status: 404 });
  }

  // Strip raw_payload (large webhook JSON) from response
  const { raw_payload: _rp, ...orderFields } =
    updatedOrder as Record<string, unknown>;

  return NextResponse.json(
    { data: { ...orderFields, history: patchHistory, order_items: patchedItems ?? [] } },
    { status: 200 },
  );
}
