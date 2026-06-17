import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { performDispatch } from "@/lib/carriers/perform-dispatch";

export const dynamic = "force-dynamic";

type ReadyRow = {
  order_id: string;
  carrier_id: string;
  scheduled_at: string;
};

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const header = req.headers.get("x-cron-secret");
  if (header !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin.rpc("dispatch_scheduled_ready", {
    p_limit: 50,
  });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch ready rows", detail: error.message },
      { status: 500 }
    );
  }

  const ready: ReadyRow[] = (rows ?? []) as ReadyRow[];

  const results: Array<{
    order_id: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const row of ready) {
    // Pull the carrier code + order-side extras the adapter needs. Dexpress
    // requires extra.state_id; Darb Assabil requires extra.city + customer_area.
    // Without them the adapter throws and the order would otherwise loop here.
    const [{ data: orderRow }, { data: carrierRow }] = await Promise.all([
      admin
        .from("orders")
        .select("dexpress_state_id, darb_destination_id")
        .eq("id", row.order_id)
        .single(),
      admin
        .from("carriers")
        .select("code")
        .eq("id", row.carrier_id)
        .single(),
    ]);

    const carrierCode = carrierRow?.code ?? "";
    const dexpressStateId = orderRow?.dexpress_state_id ?? null;
    const darbDestinationId = orderRow?.darb_destination_id ?? null;

    // Resolve the Darb (city, area) pair from the stored destination id. A
    // multi-area city resolves to no id at intake (the area is picked at
    // dispatch), so an auto-dispatched Darb order without one can't proceed.
    let darbExtra: { city: string; customer_area: string } | null = null;
    if (carrierCode === "darb_assabil" && darbDestinationId !== null) {
      const { data: dest } = await admin
        .from("darb_destinations")
        .select("city, area")
        .eq("id", darbDestinationId)
        .single();
      if (dest) darbExtra = { city: dest.city, customer_area: dest.area };
    }

    const missingDestination =
      (carrierCode === "dexpress" && dexpressStateId === null) ||
      (carrierCode === "darb_assabil" && darbExtra === null);

    if (missingDestination) {
      // Permanently broken under auto-dispatch — revert to confirmed so the
      // agent can pick the destination and upload manually. Without this branch
      // the row stays in dispatch_scheduled and every cron run fails on it.
      const note =
        carrierCode === "dexpress"
          ? "Auto-dispatch annulé: dexpress_state_id manquant — l'agent doit saisir la wilaya avant l'upload"
          : "Auto-dispatch annulé: destination Darb Assabil manquante — l'agent doit choisir la zone avant l'upload";
      const { error: revertError } = await admin.rpc("transition_order_status", {
        p_order_id: row.order_id,
        p_new_status: "confirmed",
        p_actor_id: null,
        p_actor_type: "system",
        p_note: note,
      });

      results.push({
        order_id: row.order_id,
        ok: false,
        error: revertError
          ? `reverted-to-confirmed failed: ${revertError.message}`
          : "reverted to confirmed: destination missing",
      });
      continue;
    }

    const extra =
      carrierCode === "dexpress" && dexpressStateId !== null
        ? { state_id: dexpressStateId }
        : carrierCode === "darb_assabil" && darbExtra !== null
          ? darbExtra
          : undefined;

    // dispatch_scheduled → uploaded directly. dispatch_order accepts
    // dispatch_scheduled as a source and clears scheduled_dispatch_* on
    // success. On failure the row stays dispatch_scheduled and the next
    // cron run retries it.
    const result = await performDispatch({
      orderId: row.order_id,
      carrierId: row.carrier_id,
      actorId: null,
      extra,
    });

    if (result.ok) {
      results.push({ order_id: row.order_id, ok: true });
    } else {
      results.push({
        order_id: row.order_id,
        ok: false,
        error: `upload failed: ${result.error}`,
      });
    }
  }

  return NextResponse.json({
    processed: ready.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
