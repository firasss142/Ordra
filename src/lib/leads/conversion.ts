import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadStatus } from "@/types/lead";
import type { OrderStatus } from "@/types/order-status";

export interface ConvertLeadOrderData {
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
}

export interface ConvertLeadParams {
  leadId: string;
  actorId: string;
  order: ConvertLeadOrderData;
}

export interface ConvertLeadResult {
  leadId: string;
  orderId: string;
  leadStatus: LeadStatus;
  orderStatus: OrderStatus;
  leadHistoryId: string;
  orderHistoryId: string;
}

export async function convertLeadToOrder(
  supabase: SupabaseClient,
  params: ConvertLeadParams
): Promise<ConvertLeadResult> {
  const { order } = params;

  if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
    throw new Error("quantity must be positive");
  }
  if (!Number.isFinite(order.total_price) || order.total_price < 0) {
    throw new Error("total_price must be non-negative");
  }

  const { data, error } = await supabase.rpc("convert_lead_to_order", {
    p_lead_id: params.leadId,
    p_actor_id: params.actorId,
    p_product_id: order.product_id,
    p_product_name: order.product_name,
    p_variant_label: order.variant_label,
    p_quantity: order.quantity,
    p_unit_price: order.unit_price,
    p_total_price: order.total_price,
    p_customer_name: order.customer_name,
    p_customer_phone: order.customer_phone,
    p_customer_address: order.customer_address,
    p_customer_city: order.customer_city,
    p_customer_note: order.customer_note,
  });

  if (error) throw new Error((error as { message: string }).message);

  const row = (Array.isArray(data) ? data[0] : data) as {
    lead_id: string;
    order_id: string;
    lead_status: LeadStatus;
    order_status: OrderStatus;
    lead_history_id: string;
    order_history_id: string;
  };

  return {
    leadId: row.lead_id,
    orderId: row.order_id,
    leadStatus: row.lead_status,
    orderStatus: row.order_status,
    leadHistoryId: row.lead_history_id,
    orderHistoryId: row.order_history_id,
  };
}
