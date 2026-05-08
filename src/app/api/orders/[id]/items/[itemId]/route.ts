import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canEditOrder, EDIT_BLOCKED_STATUSES } from "@/lib/order-permissions";
import type { Role } from "@/types";

export const dynamic = "force-dynamic";

async function getOrderAndCheckAccess(supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>, actor: { id: string; role: Role }, orderId: string) {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, assigned_to, market_id, delivery_fee, updated_at")
    .eq("id", orderId)
    .single();

  if (error || !order) return { error: "Order not found", status: 404 };
  if (actor.role === "agent" && order.assigned_to !== actor.id) return { error: "Order not found", status: 404 };
  if (!canEditOrder(actor.role, actor.id, order)) {
    if (EDIT_BLOCKED_STATUSES.has(order.status)) {
      return { error: "Réouvrez la commande d'abord pour modifier les détails.", status: 409 };
    }
    return { error: "Cannot edit this order", status: 409 };
  }
  return { order };
}

async function recomputeTotal(supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>, orderId: string, deliveryFee: number) {
  const { data: allItems } = await supabase
    .from("order_items")
    .select("line_total, quantity")
    .eq("order_id", orderId);

  const itemsSubtotal = (allItems ?? []).reduce(
    (sum: number, item: { line_total: number }) => sum + Number(item.line_total),
    0
  );
  const newQuantity = (allItems ?? []).reduce(
    (sum: number, item: { quantity: number }) => sum + Number(item.quantity),
    0
  );
  const newTotal = Math.round((itemsSubtotal + Number(deliveryFee ?? 0)) * 1000) / 1000;
  await supabase
    .from("orders")
    .update({
      total_price: newTotal,
      quantity: newQuantity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  return newTotal;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const check = await getOrderAndCheckAccess(supabase, actor, id);
  if ("error" in check) return NextResponse.json({ error: check.error }, { status: check.status });
  const order = check.order!;

  const { data: item, error: itemError } = await supabase
    .from("order_items")
    .select("*")
    .eq("id", itemId)
    .eq("order_id", id)
    .single();

  if (itemError || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const itemUpdates: Record<string, unknown> = {};
  let newQuantity = item.quantity as number;
  let newUnitPrice = item.unit_price as number;

  if ("quantity" in body) {
    const qty = body.quantity as number;
    if (typeof qty !== "number" || qty < 1 || !Number.isInteger(qty)) {
      return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
    }
    newQuantity = qty;
    itemUpdates.quantity = qty;
  }

  if ("unit_price" in body) {
    const price = body.unit_price as number;
    if (typeof price !== "number" || price < 0) {
      return NextResponse.json({ error: "unit_price must be >= 0" }, { status: 400 });
    }
    newUnitPrice = price;
    itemUpdates.unit_price = price;
  }

  if ("product_id" in body && body.product_id) {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, market_id, name, is_active, current_stock, default_price")
      .eq("id", body.product_id as string)
      .single();

    if (productError || !product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    if (product.market_id !== order.market_id) return NextResponse.json({ error: "Product does not belong to this market" }, { status: 409 });
    if (!product.is_active) return NextResponse.json({ error: "Product is not active" }, { status: 409 });

    itemUpdates.product_id = product.id;
    itemUpdates.product_name = product.name;
    itemUpdates.variant_id = null;
    itemUpdates.variant_label = null;
    newUnitPrice = product.default_price as number ?? newUnitPrice;
    itemUpdates.unit_price = newUnitPrice;
  }

  itemUpdates.line_total = Math.round(newQuantity * newUnitPrice * 1000) / 1000;
  itemUpdates.updated_at = new Date().toISOString();

  const { data: updatedItem, error: updateError } = await supabase
    .from("order_items")
    .update(itemUpdates)
    .eq("id", itemId)
    .select()
    .single();

  if (updateError || !updatedItem) {
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }

  await recomputeTotal(supabase, id, order.delivery_fee as number);

  return NextResponse.json({ data: updatedItem }, { status: 200 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const check = await getOrderAndCheckAccess(supabase, actor, id);
  if ("error" in check) return NextResponse.json({ error: check.error }, { status: check.status });
  const order = check.order!;

  // Check item exists and belongs to this order
  const { data: item, error: itemError } = await supabase
    .from("order_items")
    .select("id")
    .eq("id", itemId)
    .eq("order_id", id)
    .single();

  if (itemError || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Guard: cannot delete the last item
  const { data: allItems } = await supabase
    .from("order_items")
    .select("id")
    .eq("order_id", id);

  if (!allItems || allItems.length <= 1) {
    return NextResponse.json({ error: "Cannot remove the last item from an order" }, { status: 409 });
  }

  await supabase.from("order_items").delete().eq("id", itemId);

  await recomputeTotal(supabase, id, order.delivery_fee as number);

  return new NextResponse(null, { status: 204 });
}
