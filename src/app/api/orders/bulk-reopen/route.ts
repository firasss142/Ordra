import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/server";
import { getCarrierAdapter, buildConfig } from "@/lib/carriers";

export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

type OrderRow = {
  id: string;
  status: string;
  market_id: string;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_extra: Record<string, unknown> | null;
};

type CarrierRow = {
  id: string;
  code: string;
  api_endpoint: string | null;
  api_credentials: string | null;
  delivery_fee: number;
  return_fee: number;
};

type SkipReason = "order_not_found" | "wrong_market" | "not_uploaded" | "carrier_not_found";

/**
 * Bulk "reopen" of UPLOADED orders: for each, void the carrier shipment and
 * revert uploaded → confirmed (the single-order carrier-delete flow, applied to
 * a selection). Fail closed: if the carrier cancellation can't be confirmed, the
 * order is NOT reopened (returned in `void_failed`) so it can't orphan a live
 * shipment — the manager cancels at the carrier and retries with
 * `confirm_manual_cancel`. Managers/super_admin only.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_ids?: unknown; confirm_manual_cancel?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Missing order_ids" }, { status: 400 });
  }
  if (orderIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Cannot reopen more than ${MAX_BATCH} orders in one batch` },
      { status: 400 },
    );
  }
  const ids = orderIds.filter((x): x is string => typeof x === "string" && !!x);
  const confirmManualCancel = body.confirm_manual_cancel === true;

  const admin = createAdminClient();

  const { data: orderRows, error: ordersError } = await admin
    .from("orders")
    .select("id, status, market_id, tracking_number, carrier_id, carrier_extra")
    .in("id", ids);

  if (ordersError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const orderById = new Map<string, OrderRow>(
    ((orderRows as OrderRow[] | null) ?? []).map((o) => [o.id, o]),
  );

  const isSuperAdmin = actor.role === "super_admin";

  // Determine which orders are actually reopenable, and collect their carriers.
  const skipped: Array<{ order_id: string; reason: SkipReason }> = [];
  const reopenable: OrderRow[] = [];
  for (const id of ids) {
    const row = orderById.get(id);
    if (!row) {
      skipped.push({ order_id: id, reason: "order_not_found" });
      continue;
    }
    if (!isSuperAdmin && row.market_id !== actor.market_id) {
      skipped.push({ order_id: id, reason: "wrong_market" });
      continue;
    }
    if (row.status !== "uploaded" || !row.tracking_number || !row.carrier_id) {
      skipped.push({ order_id: id, reason: "not_uploaded" });
      continue;
    }
    reopenable.push(row);
  }

  // Batch-fetch the carriers (with credentials — admin only) for the void calls.
  const carrierIds = Array.from(
    new Set(reopenable.map((o) => o.carrier_id).filter((c): c is string => !!c)),
  );
  const carrierById = new Map<string, CarrierRow>();
  if (carrierIds.length > 0) {
    const { data: carriers } = await admin
      .from("carriers")
      .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
      .in("id", carrierIds);
    for (const c of (carriers as CarrierRow[] | null) ?? []) carrierById.set(c.id, c);
  }

  const succeeded: Array<{ order_id: string; void_outcome: "carrier_voided" | "local_only" }> = [];
  const failed: Array<{ order_id: string; error: string }> = [];
  // Orders whose carrier cancellation could not be confirmed — NOT reopened
  // (fail closed), so they don't orphan a live shipment.
  const voidFailed: Array<{ order_id: string; reason: string }> = [];

  for (const order of reopenable) {
    const carrier = carrierById.get(order.carrier_id!);
    if (!carrier) {
      skipped.push({ order_id: order.id, reason: "carrier_not_found" });
      continue;
    }

    // Step 1: try to void at the carrier (best-effort — failure still reopens).
    let voidOutcome: "carrier_voided" | "local_only" = "local_only";
    let voidReason: string | null = null;
    try {
      const config = buildConfig(carrier);
      const adapter = getCarrierAdapter(carrier.code);
      const result = await adapter.voidDispatch(
        order.tracking_number!,
        config,
        order.carrier_extra ?? undefined,
      );
      if (result.success) voidOutcome = "carrier_voided";
      else voidReason = result.reason ?? null;
    } catch (err) {
      voidReason = err instanceof Error ? err.message : "unknown";
    }

    // Fail closed: if the carrier cancellation wasn't confirmed, do NOT reopen
    // this order — leaving it `uploaded` keeps it out of the queue so no second
    // shipment can be created. Operator retries with confirm_manual_cancel after
    // cancelling at the carrier.
    if (voidOutcome !== "carrier_voided" && !confirmManualCancel) {
      voidFailed.push({
        order_id: order.id,
        reason: voidReason ?? "carrier cancellation not confirmed",
      });
      continue;
    }

    // Step 2: forensic log (never load-bearing).
    try {
      await admin.from("carrier_event_log").insert({
        carrier_code: carrier.code,
        source: "barcode_deletion",
        tracking_number: order.tracking_number,
        order_id: order.id,
        outcome: voidOutcome === "carrier_voided" ? "processed" : "error",
        outcome_reason: voidOutcome,
        raw_body: { reason: voidReason, bulk: true },
      });
    } catch {
      // swallow
    }

    // Step 3: flip local state (uploaded → confirmed). The RPC re-checks the
    // status under a row lock, so a concurrent change fails this order only.
    const { error: rpcError } = await admin.rpc("delete_carrier_barcode", {
      p_order_id: order.id,
      p_actor_id: actor.id,
      p_void_outcome: voidOutcome,
    });
    if (rpcError) {
      failed.push({ order_id: order.id, error: "Failed to record reopen" });
      continue;
    }
    succeeded.push({ order_id: order.id, void_outcome: voidOutcome });
  }

  return NextResponse.json({ succeeded, failed, skipped, void_failed: voidFailed });
}
