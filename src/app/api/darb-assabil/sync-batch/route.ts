import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildConfig, type CarrierRow } from "@/lib/carriers/dispatch";
import { fetchDarbShipment } from "@/lib/carriers/darb-assabil-tracking";

/**
 * POST /api/darb-assabil/sync-batch
 *
 * Refreshes Darb Assabil status for up to 25 orders in one call. Reads the
 * authoritative by-`_id` shipment (status + real reference) and writes via the
 * promote_darb_status RPC, which: refreshes carrier_status_slug, repairs
 * tracking_number to the real reference, and — for the 3 TERMINAL Darb states —
 * promotes orders.status (completed→delivered, returned→returned,
 * cancelled→cancelled) with an append-only order_history row. In-flight states
 * leave orders.status untouched (the "like Dexpress" model). No stock/cost
 * side-effects (Libya).
 *
 * Auth via the cookie-scoped Supabase client → RLS enforces market isolation.
 * Orders the caller cannot see come back as { ok: false, reason: 'not_visible' }.
 *
 * Darb's cancel/status endpoints key on the internal _id (carrier_extra
 * .darb_assabil_id), not the SH… reference. An order with no _id (dispatched
 * before id capture) comes back as { ok: false, reason: 'no_internal_id' } and
 * stays in the 'uploaded' bucket — we can't address it.
 *
 * Concurrency cap: 3 fetches in flight at any moment.
 *
 * Mapping spec: plans/darb-assabil-status-display.md.
 */

const MAX_BATCH = 25;
const CONCURRENCY = 3;

interface OrderRow {
  id: string;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_extra: Record<string, unknown> | null;
  carriers: { code: string } | null;
}

type PerOrderResult =
  | { ok: true; slug: string | null }
  | { ok: false; reason: string };

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body validation.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orderIds = (body as { orderIds?: unknown })?.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json(
      { error: "orderIds must be a non-empty array" },
      { status: 400 },
    );
  }
  if (orderIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large (max ${MAX_BATCH})` },
      { status: 400 },
    );
  }
  if (!orderIds.every((id): id is string => typeof id === "string")) {
    return NextResponse.json(
      { error: "orderIds must be strings" },
      { status: 400 },
    );
  }

  // Load the requested orders via the RLS-scoped client. Anything missing from
  // the result was hidden by RLS (or doesn't exist).
  const { data: orderRows } = await supabase
    .from("orders")
    .select(
      "id, tracking_number, carrier_id, carrier_extra, carriers!orders_carrier_id_fkey!inner(code)",
    )
    .in("id", orderIds);

  const orders = (orderRows ?? []) as unknown as OrderRow[];
  const visibleIds = new Set(orders.map((o) => o.id));

  const results: Record<string, PerOrderResult> = {};
  for (const id of orderIds) {
    if (!visibleIds.has(id)) {
      results[id] = { ok: false, reason: "not_visible" };
    }
  }

  // Determine the orders that actually need a Darb fetch.
  const fetchable: Array<OrderRow & { internalId: string }> = [];
  for (const o of orders) {
    if (o.carriers?.code !== "darb_assabil" || !o.carrier_id) {
      results[o.id] = { ok: false, reason: "not_darb" };
      continue;
    }
    if (!o.tracking_number) {
      results[o.id] = { ok: false, reason: "no_tracking" };
      continue;
    }
    const internalId =
      typeof o.carrier_extra?.darb_assabil_id === "string"
        ? o.carrier_extra.darb_assabil_id
        : "";
    if (!internalId) {
      results[o.id] = { ok: false, reason: "no_internal_id" };
      continue;
    }
    fetchable.push({ ...o, internalId });
  }

  if (fetchable.length === 0) {
    return NextResponse.json({ results }, { status: 200 });
  }

  // Load the carrier config rows for the distinct carrier_ids in the batch
  // (usually a single Darb carrier per market).
  const carrierIds = Array.from(
    new Set(fetchable.map((o) => o.carrier_id!).filter((x): x is string => !!x)),
  );
  const { data: carrierRows } = await supabase
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .in("id", carrierIds);

  const carriersById = new Map<string, CarrierRow>();
  for (const c of (carrierRows ?? []) as unknown as CarrierRow[]) {
    carriersById.set(c.id, c);
  }

  // Build (and memoize) a config per carrier_id.
  const configByCarrierId = new Map<string, ReturnType<typeof buildConfig>>();
  function configFor(carrierId: string): ReturnType<typeof buildConfig> | null {
    const cached = configByCarrierId.get(carrierId);
    if (cached) return cached;
    const row = carriersById.get(carrierId);
    if (!row) return null;
    try {
      const config = buildConfig(row);
      configByCarrierId.set(carrierId, config);
      return config;
    } catch {
      return null;
    }
  }

  const queue = [...fetchable];
  const adminPromises: Promise<unknown>[] = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const order = queue.shift();
      if (!order) return;
      await processOne(order);
    }
  }

  async function processOne(
    order: OrderRow & { internalId: string },
  ): Promise<void> {
    const config = order.carrier_id ? configFor(order.carrier_id) : null;
    if (!config) {
      results[order.id] = { ok: false, reason: "not_darb" };
      return;
    }

    let snapshot;
    try {
      snapshot = await fetchDarbShipment(order.internalId, config);
    } catch {
      results[order.id] = { ok: false, reason: "fetch_failed" };
      return;
    }

    const syncedAt = new Date().toISOString();

    if (snapshot.kind === "not_found") {
      await supabase
        .from("orders")
        .update({ carrier_status_synced_at: syncedAt })
        .eq("id", order.id);
      results[order.id] = { ok: false, reason: "not_found" };
      return;
    }

    // kind === "ok" — promote via the RPC: refreshes slug + repairs the real
    // reference + promotes orders.status for terminal Darb states (append-only
    // order_history). For a null slug (unknown status) the RPC still refreshes
    // synced_at and leaves orders.status alone.
    await supabase.rpc("promote_darb_status", {
      p_order_id: order.id,
      p_slug: snapshot.slug,
      p_reference: snapshot.reference || null,
      p_synced_at: syncedAt,
      p_actor_id: null,
    });
    results[order.id] = { ok: true, slug: snapshot.slug };

    // Fire-and-forget observability log for unknown statuses. Same shape as the
    // Dexpress route so log consumers don't need a second pattern.
    if (snapshot.slug === null && snapshot.rawStatus.length > 0) {
      const p = (async () => {
        try {
          const admin = createAdminClient();
          await admin.from("carrier_event_log").insert({
            carrier_code: "darb_assabil",
            source: "tracking_view",
            tracking_number: order.tracking_number,
            order_id: order.id,
            carrier_status_raw: snapshot.rawStatus,
            outcome: "ignored",
            outcome_reason: "unknown_darb_status",
            raw_body: { rawStatus: snapshot.rawStatus },
          });
        } catch {
          // Logging is forensic, not load-bearing. Swallow.
        }
      })();
      adminPromises.push(p);
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, fetchable.length) },
    () => worker(),
  );
  await Promise.all(workers);
  await Promise.all(adminPromises);

  return NextResponse.json({ results }, { status: 200 });
}
