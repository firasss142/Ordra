import { createAdminClient } from "@/lib/supabase/server";
import { dispatchToCarrier } from "./dispatch";
import type { CarrierOrderData } from "./types";

export interface PerformDispatchInput {
  orderId: string;
  carrierId: string;
  actorId: string | null;
  extra?: Record<string, unknown>;
}

export type PerformDispatchResult =
  | {
      ok: true;
      trackingNumber: string | null;
      dispatchData: unknown;
    }
  | {
      ok: false;
      status: number;
      error: string;
      errorCode?: string;
      retryable?: boolean;
    };

type OrderRow = {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
};

type CarrierRow = {
  id: string;
  code: string;
  api_endpoint: string | null;
  api_credentials: string | null;
  delivery_fee: number;
  return_fee: number;
};

const ORDER_COLUMNS =
  "id, status, customer_name, customer_phone, customer_address, customer_city, customer_note, product_name, variant_label, quantity, total_price";

const CARRIER_COLUMNS =
  "id, code, api_endpoint, api_credentials, delivery_fee, return_fee";

export async function performDispatch({
  orderId,
  carrierId,
  actorId,
  extra,
}: PerformDispatchInput): Promise<PerformDispatchResult> {
  const admin = createAdminClient();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single<OrderRow>();

  if (orderError || !order) {
    return { ok: false, status: 404, error: "Order not found" };
  }

  const { data: carrier, error: carrierError } = await admin
    .from("carriers")
    .select(CARRIER_COLUMNS)
    .eq("id", carrierId)
    .single<CarrierRow>();

  if (carrierError || !carrier) {
    return { ok: false, status: 404, error: "Carrier not found" };
  }

  const orderData: CarrierOrderData = {
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_address: order.customer_address,
    customer_city: order.customer_city,
    customer_note: order.customer_note,
    product_name: order.product_name,
    variant_label: order.variant_label,
    quantity: order.quantity,
    total_price: order.total_price,
  };

  let result;
  try {
    result = await dispatchToCarrier(orderData, carrier, extra);
  } catch {
    return { ok: false, status: 500, error: "Internal server error" };
  }

  if (!result.success) {
    return {
      ok: false,
      status: 422,
      error: result.errorMessage ?? "Carrier rejected the dispatch",
      errorCode: result.errorCode,
      retryable: result.retryable,
    };
  }

  const { data: dispatchData, error: dispatchError } = await admin.rpc(
    "dispatch_order",
    {
      p_order_id: orderId,
      p_carrier_id: carrierId,
      p_tracking_number: result.trackingNumber,
      p_carrier_extra: extra ?? null,
      p_actor_id: actorId,
    }
  );

  if (dispatchError) {
    return { ok: false, status: 500, error: "Failed to record dispatch" };
  }

  return {
    ok: true,
    trackingNumber: result.trackingNumber,
    dispatchData,
  };
}
