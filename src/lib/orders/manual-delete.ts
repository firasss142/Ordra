import type { SupabaseClient } from "@supabase/supabase-js";
import { buildConfig, getCarrierAdapter, type CarrierRow } from "@/lib/carriers";

export interface ManualDeleteOrderRow {
  id: string;
  status: string;
  market_id: string;
  tracking_number: string | null;
  carrier_id: string | null;
}

export class ManualDeleteCarrierVoidError extends Error {
  constructor(
    message: string,
    public readonly orderId: string,
    public readonly status = 409,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "ManualDeleteCarrierVoidError";
  }
}

export class ManualDeleteRpcError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "ManualDeleteRpcError";
  }
}

async function logCarrierVoid(
  admin: SupabaseClient,
  params: {
    carrierCode: string;
    trackingNumber: string;
    orderId: string;
    outcome: "processed" | "error";
    reason: string | null;
  },
) {
  try {
    await admin.from("carrier_event_log").insert({
      carrier_code: params.carrierCode,
      source: "barcode_deletion",
      tracking_number: params.trackingNumber,
      order_id: params.orderId,
      outcome: params.outcome,
      outcome_reason: "manual_delete",
      raw_body: { reason: params.reason },
    });
  } catch {
    // Forensics only: a logging failure must not change delete semantics.
  }
}

async function voidCarrierOrder(admin: SupabaseClient, order: ManualDeleteOrderRow) {
  if (order.status !== "uploaded" && order.status !== "scanned") return;
  if (!order.tracking_number) return;
  if (!order.carrier_id) {
    throw new ManualDeleteCarrierVoidError(
      "Order has carrier tracking but no carrier is attached",
      order.id,
      409,
      "missing_carrier",
    );
  }

  const { data: carrierRow, error: carrierError } = await admin
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", order.carrier_id)
    .single<CarrierRow>();

  if (carrierError || !carrierRow) {
    throw new ManualDeleteCarrierVoidError(
      "Carrier not found",
      order.id,
      404,
      carrierError?.message ?? "carrier_not_found",
    );
  }

  try {
    const config = buildConfig(carrierRow);
    const adapter = getCarrierAdapter(carrierRow.code);
    const result = await adapter.voidDispatch(order.tracking_number, config);

    if (!result.success) {
      const reason =
        result.reason ??
        (result.supported
          ? "carrier_void_failed"
          : "carrier_void_not_supported");
      await logCarrierVoid(admin, {
        carrierCode: carrierRow.code,
        trackingNumber: order.tracking_number,
        orderId: order.id,
        outcome: "error",
        reason,
      });
      throw new ManualDeleteCarrierVoidError(
        "Carrier void failed",
        order.id,
        409,
        reason,
      );
    }

    await logCarrierVoid(admin, {
      carrierCode: carrierRow.code,
      trackingNumber: order.tracking_number,
      orderId: order.id,
      outcome: "processed",
      reason: null,
    });
  } catch (err) {
    if (err instanceof ManualDeleteCarrierVoidError) throw err;
    const reason = err instanceof Error ? err.message : "carrier_void_failed";
    await logCarrierVoid(admin, {
      carrierCode: carrierRow.code,
      trackingNumber: order.tracking_number,
      orderId: order.id,
      outcome: "error",
      reason,
    });
    throw new ManualDeleteCarrierVoidError(
      "Carrier void failed",
      order.id,
      409,
      reason,
    );
  }
}

export async function manualDeleteOrders(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: {
    orders: ManualDeleteOrderRow[];
    actorId: string;
    note: string | null;
  },
) {
  for (const order of params.orders) {
    await voidCarrierOrder(admin, order);
  }

  const { data, error } = await supabase.rpc("manual_delete_orders", {
    p_order_ids: params.orders.map((order) => order.id),
    p_actor_id: params.actorId,
    p_note: params.note,
  });

  if (error) {
    throw new ManualDeleteRpcError(error.message ?? "Manual delete failed");
  }

  return data;
}
