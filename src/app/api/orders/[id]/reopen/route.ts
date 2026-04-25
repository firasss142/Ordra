import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canReopenOrder } from "@/lib/order-permissions";
import { getCarrierAdapter, buildConfig } from "@/lib/carriers";
import { getActor } from "@/lib/auth/actor";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to, updated_at, tracking_number, carrier_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canReopenOrder("agent", actor.id, order)) {
    return NextResponse.json({ error: "Cannot reopen this order" }, { status: 409 });
  }

  let voidOutcome: "carrier_voided" | "local_only" | "no_barcode" = "no_barcode";
  let warning: string | undefined;

  if (order.tracking_number && order.carrier_id) {
    const { data: carrierRow } = await supabase
      .from("carriers")
      .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
      .eq("id", order.carrier_id)
      .single();

    if (carrierRow) {
      try {
        const config = buildConfig(carrierRow);
        const adapter = getCarrierAdapter(carrierRow.code);
        const voidResult = await adapter.voidDispatch(
          order.tracking_number,
          config,
        );
        if (voidResult.success) {
          voidOutcome = "carrier_voided";
        } else {
          voidOutcome = "local_only";
          warning = voidResult.supported
            ? "Annulation transporteur échouée — contactez-les manuellement"
            : "Ce transporteur ne supporte pas l'annulation automatique — contactez-les manuellement";
        }
      } catch {
        voidOutcome = "local_only";
        warning = "Annulation transporteur échouée — contactez-les manuellement";
      }
    } else {
      voidOutcome = "local_only";
      warning = "Transporteur introuvable — coordination manuelle requise";
    }
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("reopen_order", {
    p_order_id: orderId,
    p_actor_id: actor.id,
    p_void_outcome: voidOutcome,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const body: Record<string, unknown> = { data: rpcData };
  if (warning) body.warning = warning;

  return NextResponse.json(body, { status: 200 });
}
