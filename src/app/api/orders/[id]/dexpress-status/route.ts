import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildConfig } from "@/lib/carriers/dispatch";
import { DexpressClient } from "@/lib/carriers/dexpress/client";
import { fetchDexpressStatus } from "@/lib/carriers/dexpress/tracking";

/**
 * GET /api/orders/[id]/dexpress-status
 *
 * Returns the current Dexpress-side status for a single Dexpress order.
 * Read-only. Does not mutate OMS state. Auth via the user's RLS-scoped
 * Supabase client — market isolation is enforced at the data layer, not in
 * application code.
 *
 * Response shapes:
 *   200 → { kind: "ok", trackingNumber, slug, statusId, rawLabel, isAccepted }
 *   404 → { kind: "not_found", trackingNumber }       (Dexpress doesn't recognize the ID)
 *   404 → { error: "Not found" }                       (OMS doesn't have this order / RLS hides it)
 *   400 → { error: "..." }                             (carrier not dexpress / no tracking number)
 *   401 → { error: "Unauthorized" }
 *   502 → { error, message }                           (network error / unrecoverable session / unexpected response)
 */

interface OrderJoinRow {
  id: string;
  tracking_number: string | null;
  carrier_id: string | null;
  carriers: { code: string } | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  void req;
  const { id: orderId } = await params;
  const supabase = await createClient();

  // 1. Auth via the cookie-scoped client.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Load the order via the RLS-scoped client. RLS filters by market —
  //    a cross-market access attempt returns no row (treated as 404 here).
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, tracking_number, carrier_id, carriers!orders_carrier_id_fkey!inner(code)",
    )
    .eq("id", orderId)
    .single<OrderJoinRow>();

  if (orderError || !order) {
    if (orderError) {
      console.error("[dexpress-status] order query failed", {
        orderId,
        code: orderError.code,
        message: orderError.message,
        details: orderError.details,
      });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3. Eligibility: only Dexpress orders with a tracking number reach the carrier.
  if (order.carriers?.code !== "dexpress") {
    return NextResponse.json(
      { error: "Order carrier is not Dexpress" },
      { status: 400 },
    );
  }
  if (!order.tracking_number) {
    return NextResponse.json(
      { error: "Order has no tracking number" },
      { status: 400 },
    );
  }
  if (!order.carrier_id) {
    return NextResponse.json(
      { error: "Order has no carrier_id" },
      { status: 400 },
    );
  }

  // 4. Load carrier config. Market match was established by the RLS-scoped
  //    order query above, so this carrier read via the same client is safe.
  const { data: carrierRow, error: carrierError } = await supabase
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", order.carrier_id)
    .single();

  if (carrierError || !carrierRow) {
    return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  }

  // 5. Fetch the live Dexpress status. Network / session / unexpected-shape
  //    failures throw; we surface those as 502. Not-found is a snapshot kind,
  //    not an error.
  let snapshot;
  try {
    const config = buildConfig(carrierRow);
    const client = new DexpressClient(carrierRow.id, config);
    snapshot = await fetchDexpressStatus(order.tracking_number, client);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "DEXPRESS_FETCH_FAILED", message },
      { status: 502 },
    );
  }

  // 6. Dexpress-side not-found: distinct UX. No log row (clean signal).
  if (snapshot.kind === "not_found") {
    return NextResponse.json(snapshot, {
      status: 404,
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  // 7. Unknown status ID observability log (fire-and-forget — log failure
  //    must not break the response, per the briefing's graceful-degradation
  //    rule). Only fires when the rawLabel has content but the taxonomy
  //    didn't resolve it — meaning Dexpress sent a status ID we haven't
  //    seen before.
  if (snapshot.slug === null && snapshot.rawLabel.length > 0) {
    try {
      const admin = createAdminClient();
      await admin.from("carrier_event_log").insert({
        carrier_code: "dexpress",
        source: "tracking_view",
        tracking_number: order.tracking_number,
        order_id: order.id,
        carrier_status_raw: snapshot.rawLabel,
        outcome: "ignored",
        outcome_reason: "unknown_dexpress_status_id",
        raw_body: {
          statusId: snapshot.statusId,
          rawLabel: snapshot.rawLabel,
          isAccepted: snapshot.isAccepted,
        },
      });
    } catch {
      // Logging is forensic, not load-bearing. Swallow.
    }
  }

  return NextResponse.json(snapshot, {
    status: 200,
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
