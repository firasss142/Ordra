import { createAdminClient } from "@/lib/supabase/server";
import { dispatchToCarrier } from "./dispatch";
import type { CarrierOrderData } from "./types";
import type { OrderItem } from "@/types/order-items";

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
  market_id: string;
  customer_name: string;
  customer_phone: string;
  customer_phone_2: string | null;
  customer_whatsapp: string | null;
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
  market_id: string;
  is_active: boolean;
};

const ORDER_COLUMNS =
  "id, status, market_id, customer_name, customer_phone, customer_phone_2, customer_whatsapp, customer_address, customer_city, customer_note, product_name, variant_label, quantity, total_price";

const CARRIER_COLUMNS =
  "id, code, api_endpoint, api_credentials, delivery_fee, return_fee, market_id, is_active";

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
    console.error("[performDispatch] order lookup failed", {
      orderId,
      code: orderError?.code,
      message: orderError?.message,
    });
    return {
      ok: false,
      status: 404,
      error: `Order not found (${orderError?.code ?? "no_row"}: ${orderError?.message ?? "no rows returned"})`,
    };
  }

  const { data: carrier, error: carrierError } = await admin
    .from("carriers")
    .select(CARRIER_COLUMNS)
    .eq("id", carrierId)
    .single<CarrierRow>();

  if (carrierError || !carrier) {
    console.error("[performDispatch] carrier lookup failed", {
      carrierId,
      code: carrierError?.code,
      message: carrierError?.message,
    });
    return {
      ok: false,
      status: 404,
      error: `Carrier not found (${carrierError?.code ?? "no_row"}: ${carrierError?.message ?? "no rows returned"})`,
    };
  }

  if (carrier.market_id !== order.market_id) {
    return {
      ok: false,
      status: 400,
      error: "Carrier does not belong to the order's market",
    };
  }

  if (!carrier.is_active) {
    return {
      ok: false,
      status: 400,
      error: "Carrier is not active",
    };
  }

  // Itemized line items for carriers that send a real products[] (Darb Assabil).
  // Adapters that don't need them ignore order_items; an empty array means the
  // adapter falls back to its legacy single-line projection.
  const { data: itemRows } = await admin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  const orderItems = (itemRows as OrderItem[] | null) ?? [];

  const orderData: CarrierOrderData = {
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_phone_2: order.customer_phone_2,
    customer_whatsapp: order.customer_whatsapp,
    customer_address: order.customer_address,
    customer_city: order.customer_city,
    customer_note: order.customer_note,
    product_name: order.product_name,
    variant_label: order.variant_label,
    quantity: order.quantity,
    total_price: order.total_price,
    order_items: orderItems,
  };

  let result;
  try {
    result = await dispatchToCarrier(orderData, carrier, extra);
  } catch (err) {
    console.error("[performDispatch] dispatchToCarrier threw", {
      orderId,
      carrierId,
      carrierCode: carrier.code,
      error: err instanceof Error ? err.message : String(err),
    });
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

  // Persist the caller's extra (e.g. dispatch-time picker values) plus any
  // carrier-returned extra (e.g. Darb Assabil's internal _id) on carrier_extra.
  const mergedExtra = { ...(extra ?? {}), ...(result.extra ?? {}) };
  const carrierExtra =
    Object.keys(mergedExtra).length > 0 ? mergedExtra : null;

  const { data: dispatchData, error: dispatchError } = await admin.rpc(
    "dispatch_order",
    {
      p_order_id: orderId,
      p_carrier_id: carrierId,
      p_tracking_number: result.trackingNumber,
      p_carrier_extra: carrierExtra,
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
