import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canEditOrder, EDIT_BLOCKED_STATUSES } from "@/lib/order-permissions";
import { computeOrderTotal, roundLineTotal } from "@/lib/calculations/order-total";
import type { Role } from "@/types";
import type { OrderItem } from "@/types/order-items";

type OrderItemInsert = Omit<OrderItem, "id" | "created_at" | "updated_at">;

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

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, status, assigned_to, market_id, delivery_fee, card_payment, updated_at, product_id, product_name, variant_label, quantity, unit_price"
    )
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (actor.role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!canEditOrder(actor.role as Role, actor.id, order)) {
    if (EDIT_BLOCKED_STATUSES.has(order.status)) {
      return NextResponse.json(
        { error: "Réouvrez la commande d'abord pour modifier les détails." },
        { status: 409 }
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

  const { product_id, quantity, unit_price, variant_id } = body as {
    product_id?: string;
    quantity?: number;
    unit_price?: number;
    variant_id?: string | null;
  };

  if (!product_id) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }
  if (typeof quantity !== "number" || quantity < 1 || !Number.isInteger(quantity)) {
    return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
  }
  if (typeof unit_price !== "number" || unit_price < 0) {
    return NextResponse.json({ error: "unit_price must be >= 0" }, { status: 400 });
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, market_id, name, current_stock, is_active")
    .eq("id", product_id)
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
  if (Number(product.current_stock ?? 0) < quantity) {
    return NextResponse.json({ error: "Product is out of stock" }, { status: 409 });
  }

  let variantLabel: string | null = null;
  if (variant_id) {
    const { data: variant, error: variantError } = await supabase
      .from("product_variants")
      .select("id, product_id, label, is_active")
      .eq("id", variant_id)
      .single();

    if (variantError || !variant) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    }
    if (variant.product_id !== product_id) {
      return NextResponse.json({ error: "Variant does not belong to this product" }, { status: 409 });
    }
    if (!variant.is_active) {
      return NextResponse.json({ error: "Variant is not active" }, { status: 409 });
    }
    variantLabel = variant.label as string;
  }

  // Fetch existing items once — we use this both to decide whether a legacy
  // backfill is needed AND as the basis for the new total/quantity, so we
  // never need a second SELECT after the inserts.
  const { data: existingItems, error: existingItemsError } = await supabase
    .from("order_items")
    .select("line_total, quantity")
    .eq("order_id", id);

  if (existingItemsError) {
    console.error("[items POST] failed to read existing order_items", existingItemsError);
    return NextResponse.json({ error: "Failed to add item" }, { status: 500 });
  }

  const rowsToInsert: OrderItemInsert[] = [];

  // Webhook-created orders only populate orders.product_id/quantity/unit_price
  // and skip order_items entirely. Without materializing that snapshot before
  // appending a new item, the original product would disappear from the UI
  // (which reads order_items when non-empty) and from the recomputed total.
  if (!existingItems?.length && order.product_id && order.product_name) {
    const legacyQty = Number(order.quantity) || 1;
    const legacyUnitPrice = Number(order.unit_price ?? 0);
    // orders has variant_label (a snapshot) but no variant_id — variants are
    // a per-line concept that only the order_items table tracks. So when we
    // materialize a legacy single-product order, variant_id is null.
    rowsToInsert.push({
      order_id: id,
      product_id: order.product_id,
      product_name: order.product_name,
      variant_id: null,
      variant_label: order.variant_label ?? null,
      quantity: legacyQty,
      unit_price: legacyUnitPrice,
      line_total: roundLineTotal(legacyQty, legacyUnitPrice),
    });
  }

  rowsToInsert.push({
    order_id: id,
    product_id,
    product_name: product.name,
    variant_id: variant_id ?? null,
    variant_label: variantLabel,
    quantity,
    unit_price,
    line_total: roundLineTotal(quantity, unit_price),
  });

  const { data: insertedRows, error: insertError } = await supabase
    .from("order_items")
    .insert(rowsToInsert)
    .select();

  if (insertError || !insertedRows?.length) {
    console.error("[items POST] failed to insert order_items", insertError);
    return NextResponse.json({ error: "Failed to add item" }, { status: 500 });
  }

  const sumBy = <T,>(rows: T[], key: keyof T) =>
    rows.reduce((s, r) => s + Number(r[key]), 0);
  const itemsSubtotal =
    sumBy(existingItems ?? [], "line_total") + sumBy(rowsToInsert, "line_total");
  const newQuantity =
    sumBy(existingItems ?? [], "quantity") + sumBy(rowsToInsert, "quantity");
  const newTotal = computeOrderTotal(
    itemsSubtotal,
    Number(order.delivery_fee ?? 0),
    Boolean(order.card_payment),
  );

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      total_price: newTotal,
      quantity: newQuantity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    // Items already landed; the order's denormalized totals are now stale.
    // Surface this so an operator can re-sync rather than letting the drift
    // silently propagate.
    console.error("[items POST] failed to update orders totals after insert", updateError);
  }

  // Return the user-facing new item (always last in the insert array — the
  // legacy backfill, when present, is the first row).
  const newItem = insertedRows[insertedRows.length - 1];
  return NextResponse.json({ data: newItem }, { status: 201 });
}
