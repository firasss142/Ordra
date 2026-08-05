import { createAdminClient } from "@/lib/supabase/server";
import { dispatchToCarrier, buildConfig } from "./dispatch";
import {
  CARRIER_WAREHOUSE_FLAG,
  loadCarrierProductMappings,
  resolveWarehouseLines,
  fetchDarbWarehouseStock,
  checkWarehouseStock,
  effectiveOrderLines,
} from "./carrier-warehouse";
import type { CarrierOrderData } from "./types";
import type { OrderItem } from "@/types/order-items";

/** Reads a boolean-ish flag from the dispatch `extra` (true only for true/"1"/1). */
function extraFlag(
  extra: Record<string, unknown> | undefined,
  key: string
): boolean {
  const v = extra?.[key];
  return v === true || v === "1" || v === 1;
}

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
  tracking_number: string | null;
  customer_name: string;
  customer_phone: string;
  customer_phone_2: string | null;
  customer_whatsapp: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
  product_id: string | null;
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

// product_id is needed for carrier-warehouse fulfilment: orders predating
// order_items map to carrier stock through the header product.
const ORDER_COLUMNS =
  "id, status, market_id, tracking_number, customer_name, customer_phone, customer_phone_2, customer_whatsapp, customer_address, customer_city, customer_note, product_id, product_name, variant_label, quantity, total_price";

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

  // Duplicate-shipment backstop: a dispatchable order must not already carry a
  // live tracking number. If it does, a prior reopen/cancel didn't clear it (or
  // never confirmed the carrier-side cancellation) — uploading now would create
  // a SECOND shipment. Refuse, regardless of carrier or upload path.
  if (order.tracking_number) {
    return {
      ok: false,
      status: 409,
      error: `Order already has an active shipment (${order.tracking_number}). Cancel it before re-uploading.`,
      errorCode: "active_shipment_exists",
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

  // ── Carrier-warehouse fulfilment ──────────────────────────────────
  // The adapter is synchronous and cannot query, so the carrier-side ids are
  // resolved here and threaded through `extra`. Any gap aborts the dispatch:
  // these goods already sit in the carrier's warehouse, so quietly shipping
  // home mode would ask them to collect a package we do not have.
  let dispatchExtra = extra;
  if (extraFlag(extra, CARRIER_WAREHOUSE_FLAG)) {
    // Orders predating order_items describe their goods on the header only;
    // promote that to one synthetic line so both shapes resolve identically.
    const lines = effectiveOrderLines(orderItems, {
      product_id: order.product_id,
      product_name: order.product_name,
      variant_label: order.variant_label,
      quantity: order.quantity,
      total_price: order.total_price,
    });
    // The adapter zips warehouse lines positionally against order_items, so it
    // must see the same list we resolved against.
    orderData.order_items = lines;

    const productIds = [
      ...new Set(
        lines
          .map((it) => it.product_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const mappings = await loadCarrierProductMappings(
      admin,
      carrierId,
      productIds
    );
    const resolved = resolveWarehouseLines(mappings, lines);
    if (!resolved.ok) {
      return { ok: false, status: 422, error: resolved.error };
    }

    let config;
    try {
      config = buildConfig(carrier);
    } catch {
      return {
        ok: false,
        status: 500,
        error: "Failed to parse carrier credentials",
      };
    }

    const stock = await fetchDarbWarehouseStock(config, resolved.warehouseId);
    const stockCheck = checkWarehouseStock(resolved.lines, lines, stock);
    if (!stockCheck.ok) {
      return { ok: false, status: 422, error: stockCheck.error };
    }

    dispatchExtra = {
      ...(extra ?? {}),
      carrier_warehouse_id: resolved.warehouseId,
      warehouse_lines_json: JSON.stringify(resolved.lines),
    };
  }

  let result;
  try {
    result = await dispatchToCarrier(orderData, carrier, dispatchExtra);
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
  // Uses dispatchExtra so the resolved carrier-warehouse ids are recorded too —
  // the fulfil_from_carrier_warehouse flag on carrier_extra is what tells
  // transition_order_status and the scan-out route to skip the stock boundary.
  const mergedExtra = { ...(dispatchExtra ?? {}), ...(result.extra ?? {}) };
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
