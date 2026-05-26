import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildConfig, type CarrierRow } from "@/lib/carriers/dispatch";
import { DexpressClient } from "@/lib/carriers/dexpress/client";
import { fetchDexpressStatus } from "@/lib/carriers/dexpress/tracking";

/**
 * POST /api/dexpress/sync-batch
 *
 * Refreshes the cached Dexpress status slug for up to 25 orders in one call.
 * Read-the-portal / write-the-projection-column. Does NOT mutate orders.status.
 *
 * Auth via the cookie-scoped Supabase client → RLS enforces market isolation.
 * Orders the caller cannot see come back as { ok: false, reason: 'not_visible' }.
 *
 * Concurrency cap: 3 Dexpress fetches in flight at any moment. Sized to stay
 * inside Vercel Hobby's serverless time budget for a full 25-order batch
 * while staying polite to the Dexpress portal.
 *
 * Mapping spec: plans/dexpress-list-status-bucket.md.
 */

const MAX_BATCH = 25;
const CONCURRENCY = 3;

interface OrderRow {
  id: string;
  tracking_number: string | null;
  carrier_id: string | null;
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

  // Load the requested orders via the RLS-scoped client. Anything missing
  // from the result was hidden by RLS (or simply doesn't exist).
  const { data: orderRows } = await supabase
    .from("orders")
    .select(
      "id, tracking_number, carrier_id, carriers!orders_carrier_id_fkey!inner(code)",
    )
    .in("id", orderIds);

  // Supabase types the joined `carriers` as an array because the relationship
  // isn't statically known to be 1-to-1 — at runtime the !inner select returns
  // one object per row. The cast is the same pattern as the per-order route.
  const orders = (orderRows ?? []) as unknown as OrderRow[];
  const visibleIds = new Set(orders.map((o) => o.id));

  // Pre-populate results with the per-id outcomes we can determine without
  // hitting the carrier (not_visible, not_dexpress, no_tracking).
  const results: Record<string, PerOrderResult> = {};
  for (const id of orderIds) {
    if (!visibleIds.has(id)) {
      results[id] = { ok: false, reason: "not_visible" };
    }
  }

  // Collect the orders that actually need a Dexpress fetch.
  const fetchable: OrderRow[] = [];
  for (const o of orders) {
    if (o.carriers?.code !== "dexpress" || !o.carrier_id) {
      results[o.id] = { ok: false, reason: "not_dexpress" };
      continue;
    }
    if (!o.tracking_number) {
      results[o.id] = { ok: false, reason: "no_tracking" };
      continue;
    }
    fetchable.push(o);
  }

  if (fetchable.length === 0) {
    return NextResponse.json({ results }, { status: 200 });
  }

  // Load the carrier config rows for the distinct carrier_ids in the batch.
  // In practice there's a single Dexpress carrier per market, so this is
  // usually 1-2 rows.
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

  // Build a client per carrier_id so we share Dexpress sessions across orders
  // in the same carrier.
  const clientByCarrierId = new Map<string, DexpressClient>();
  function clientFor(carrierId: string): DexpressClient | null {
    const cached = clientByCarrierId.get(carrierId);
    if (cached) return cached;
    const row = carriersById.get(carrierId);
    if (!row) return null;
    try {
      const config = buildConfig(row);
      const client = new DexpressClient(row.id, config);
      clientByCarrierId.set(carrierId, client);
      return client;
    } catch {
      return null;
    }
  }

  // Concurrency-limited fan-out. Simple worker pool: take items from a queue
  // until empty, runs CONCURRENCY workers in parallel.
  const queue = [...fetchable];
  const adminPromises: Promise<unknown>[] = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const order = queue.shift();
      if (!order) return;
      await processOne(order);
    }
  }

  async function processOne(order: OrderRow): Promise<void> {
    const client = order.carrier_id ? clientFor(order.carrier_id) : null;
    if (!client) {
      results[order.id] = { ok: false, reason: "not_dexpress" };
      return;
    }

    let snapshot;
    try {
      snapshot = await fetchDexpressStatus(order.tracking_number!, client);
    } catch {
      results[order.id] = { ok: false, reason: "fetch_failed" };
      return;
    }

    const syncedAt = new Date().toISOString();

    if (snapshot.kind === "not_found") {
      await supabase
        .from("orders")
        .update({ dexpress_status_synced_at: syncedAt })
        .eq("id", order.id);
      results[order.id] = { ok: false, reason: "not_found" };
      return;
    }

    // kind === "ok"
    await supabase
      .from("orders")
      .update({
        dexpress_status_slug: snapshot.slug,
        dexpress_status_synced_at: syncedAt,
      })
      .eq("id", order.id);
    results[order.id] = { ok: true, slug: snapshot.slug };

    // Fire-and-forget observability log for unknown status IDs. Same shape
    // as the per-order route in /api/orders/[id]/dexpress-status so log
    // consumers don't need a second pattern.
    if (snapshot.slug === null && snapshot.rawLabel.length > 0) {
      const p = (async () => {
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
