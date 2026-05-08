import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canEditOrder, EDIT_BLOCKED_STATUSES } from "@/lib/order-permissions";
import type { Role } from "@/types";

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
    .select("id, status, assigned_to, market_id, delivery_fee, updated_at")
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

  const lineTotal = Math.round(unit_price * quantity * 1000) / 1000;

  const { data: newItem, error: insertError } = await supabase
    .from("order_items")
    .insert({
      order_id: id,
      product_id,
      product_name: product.name,
      variant_id: variant_id ?? null,
      variant_label: variantLabel,
      quantity,
      unit_price,
      line_total: lineTotal,
    })
    .select()
    .single();

  if (insertError || !newItem) {
    return NextResponse.json({ error: "Failed to add item" }, { status: 500 });
  }

  // Recompute total_price = SUM(line_total) + delivery_fee, and quantity = SUM(quantity)
  const { data: allItems } = await supabase
    .from("order_items")
    .select("line_total, quantity")
    .eq("order_id", id);

  const itemsSubtotal = (allItems ?? []).reduce(
    (sum: number, item: { line_total: number }) => sum + Number(item.line_total),
    0
  );
  const newQuantity = (allItems ?? []).reduce(
    (sum: number, item: { quantity: number }) => sum + Number(item.quantity),
    0
  );
  const newTotal = Math.round((itemsSubtotal + Number(order.delivery_fee ?? 0)) * 1000) / 1000;

  await supabase
    .from("orders")
    .update({
      total_price: newTotal,
      quantity: newQuantity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ data: newItem }, { status: 201 });
}
