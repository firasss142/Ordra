import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/types/order-status";
import { validateTransition, buildOrderHistoryEntry } from "./order-engine";
import { calculateStockAfterMovement } from "./product-calculations";

export interface FulfillmentResult {
  order: { id: string; status: OrderStatus; updated_at: string };
  historyEntry: { id: string };
  inventoryLogEntry: { id: string } | null;
}

const STOCK_AFFECTING_STATUSES = new Set<OrderStatus>(["deposit", "returned"]);

export async function applyFulfillmentTransition(
  supabase: SupabaseClient,
  orderId: string,
  newStatus: OrderStatus,
  actorId: string,
  options?: { isDamaged?: boolean; note?: string }
): Promise<FulfillmentResult> {
  const isDamaged = options?.isDamaged ?? false;
  const note = options?.note;

  // Pre-flight guard
  if (isDamaged && newStatus !== "returned") {
    throw new Error("is_damaged flag only valid for returned status");
  }

  // 1. Fetch order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, quantity, product_id, updated_at")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? "Order not found");
  }

  // 2. Validate transition
  const validation = validateTransition(order.status as OrderStatus, newStatus);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  let inventoryLogId: string | null = null;

  // 3. Stock adjustments (deposit or returned)
  if (STOCK_AFFECTING_STATUSES.has(newStatus)) {
    if (!order.product_id) {
      throw new Error("Order has no linked product");
    }

    // Idempotency: skip mutation if a log row already exists for this (order_id, reason)
    const logReason = newStatus === "deposit" ? "deposit" : isDamaged ? "damaged_writeoff" : "returned";
    const { data: existingLog } = await supabase
      .from("inventory_log")
      .select("id")
      .eq("order_id", orderId)
      .eq("reason", logReason)
      .maybeSingle();

    if (existingLog) {
      inventoryLogId = existingLog.id as string;
    } else {
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id, current_stock, damaged_return_count")
        .eq("id", order.product_id)
        .single();

      if (productError || !product) {
        throw new Error(productError?.message ?? "Product not found");
      }

      if (newStatus === "deposit") {
        // Decrement stock — throws if result < 0
        const newStock = calculateStockAfterMovement(product.current_stock, -order.quantity);

        const { error: updateErr } = await supabase
          .from("products")
          .update({ current_stock: newStock })
          .eq("id", order.product_id);

        if (updateErr) throw new Error(updateErr.message);

        const { data: logRow, error: logErr } = await supabase
          .from("inventory_log")
          .insert({
            product_id: order.product_id,
            order_id: orderId,
            change: -order.quantity,
            reason: "deposit",
            is_damaged: false,
            balance_after: newStock,
            note: "Stock déduit au dépôt",
          })
          .select()
          .single();

        if (logErr) throw new Error(logErr.message);
        inventoryLogId = logRow.id;

      } else if (newStatus === "returned" && !isDamaged) {
        const newStock = calculateStockAfterMovement(product.current_stock, order.quantity);

        const { error: updateErr } = await supabase
          .from("products")
          .update({ current_stock: newStock })
          .eq("id", order.product_id);

        if (updateErr) throw new Error(updateErr.message);

        const { data: logRow, error: logErr } = await supabase
          .from("inventory_log")
          .insert({
            product_id: order.product_id,
            order_id: orderId,
            change: order.quantity,
            reason: "returned",
            is_damaged: false,
            balance_after: newStock,
            note: "Retour normal",
          })
          .select()
          .single();

        if (logErr) throw new Error(logErr.message);
        inventoryLogId = logRow.id;

      } else if (newStatus === "returned" && isDamaged) {
        const newDamaged = product.damaged_return_count + order.quantity;

        const { error: updateErr } = await supabase
          .from("products")
          .update({ damaged_return_count: newDamaged })
          .eq("id", order.product_id);

        if (updateErr) throw new Error(updateErr.message);

        const { data: logRow, error: logErr } = await supabase
          .from("inventory_log")
          .insert({
            product_id: order.product_id,
            order_id: orderId,
            change: 0,
            reason: "damaged_writeoff",
            is_damaged: true,
            balance_after: newDamaged,
            note: "Retour endommagé",
          })
          .select()
          .single();

        if (logErr) throw new Error(logErr.message);
        inventoryLogId = logRow.id;
      }
    }
  }

  // 4. Update order status
  const { data: updatedOrder, error: updateOrderErr } = await supabase
    .from("orders")
    .update({ status: newStatus })
    .eq("id", orderId)
    .select("id, status, updated_at")
    .single();

  if (updateOrderErr || !updatedOrder) {
    throw new Error(updateOrderErr?.message ?? "Failed to update order");
  }

  // 5. Insert order_history
  const historyEntry = buildOrderHistoryEntry(orderId, order.status, newStatus, actorId, note);

  const { data: historyRow, error: historyErr } = await supabase
    .from("order_history")
    .insert(historyEntry)
    .select()
    .single();

  if (historyErr || !historyRow) {
    throw new Error(historyErr?.message ?? "Failed to insert order history");
  }

  return {
    order: {
      id: updatedOrder.id,
      status: updatedOrder.status as OrderStatus,
      updated_at: updatedOrder.updated_at,
    },
    historyEntry: { id: historyRow.id },
    inventoryLogEntry: inventoryLogId ? { id: inventoryLogId } : null,
  };
}
