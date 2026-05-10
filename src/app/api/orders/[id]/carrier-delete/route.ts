import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { getCarrierAdapter, buildConfig } from "@/lib/carriers";
import type { Role } from "@/types";

interface OrderRow {
  id: string;
  status: string;
  assigned_to: string | null;
  market_id: string;
  tracking_number: string | null;
  carrier_id: string | null;
}

function canDeleteCarrierBarcode(
  role: Role,
  actorId: string,
  actorMarketId: string,
  order: OrderRow,
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return order.market_id === actorMarketId;
  if (role === "agent") return order.assigned_to === actorId;
  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to, market_id, tracking_number, carrier_id")
    .eq("id", orderId)
    .single<OrderRow>();

  if (orderError || !order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (
    !canDeleteCarrierBarcode(
      actor.role as Role,
      actor.id,
      actor.market_id ?? "",
      order,
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (order.status !== "uploaded" || !order.tracking_number || !order.carrier_id) {
    return NextResponse.json(
      { error: "Order is not in a deletable state" },
      { status: 409 },
    );
  }

  const { data: carrierRow, error: carrierError } = await supabase
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", order.carrier_id)
    .single();

  if (carrierError || !carrierRow) {
    return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  }

  // Step 1: try to void at the carrier
  let voidOutcome: "carrier_voided" | "local_only" = "local_only";
  let voidReason: string | null = null;
  let warning: string | undefined;

  try {
    const config = buildConfig(carrierRow);
    const adapter = getCarrierAdapter(carrierRow.code);
    const result = await adapter.voidDispatch(order.tracking_number, config);
    if (result.success) {
      voidOutcome = "carrier_voided";
    } else {
      voidReason = result.reason ?? null;
      warning = result.supported
        ? "Suppression chez transporteur échouée — coordination manuelle requise"
        : "Ce transporteur ne supporte pas la suppression automatique — coordination manuelle requise";
    }
  } catch (err) {
    voidReason = err instanceof Error ? err.message : "unknown";
    warning = "Suppression chez transporteur échouée — coordination manuelle requise";
  }

  // Step 2: best-effort log to carrier_event_log (don't fail the request on
  // logging errors — the deletion is the source of truth)
  try {
    const admin = createAdminClient();
    await admin.from("carrier_event_log").insert({
      carrier_code: carrierRow.code,
      source: "barcode_deletion",
      tracking_number: order.tracking_number,
      order_id: order.id,
      outcome: voidOutcome === "carrier_voided" ? "processed" : "error",
      outcome_reason: voidOutcome,
      raw_body: { reason: voidReason },
    });
  } catch {
    // swallow — logging is forensic, not load-bearing
  }

  // Step 3: flip local state via RPC
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "delete_carrier_barcode",
    {
      p_order_id: orderId,
      p_actor_id: actor.id,
      p_void_outcome: voidOutcome,
    },
  );

  if (rpcError) {
    console.error("[carrier-delete] delete_carrier_barcode RPC failed", {
      orderId,
      actorId: actor.id,
      voidOutcome,
      code: rpcError.code,
      message: rpcError.message,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    return NextResponse.json(
      {
        error: "Failed to record deletion",
        debug: {
          code: rpcError.code ?? null,
          message: rpcError.message ?? null,
          details: rpcError.details ?? null,
          hint: rpcError.hint ?? null,
        },
      },
      { status: 500 },
    );
  }

  const body: Record<string, unknown> = {
    data: { ...(rpcData ?? {}), void_outcome: voidOutcome },
  };
  if (warning) body.warning = warning;

  return NextResponse.json(body, { status: 200 });
}
