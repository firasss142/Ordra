import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { buildConfig, type CarrierRow } from "@/lib/carriers/dispatch";
import { fetchDarbShipment } from "@/lib/carriers/darb-assabil-tracking";

/**
 * POST /api/darb-assabil/sync-market
 *
 * App-launch, market-wide, THROTTLED Darb status sweep. Fires once when the app
 * opens; the claim_darb_sync RPC enforces "at most once per throttle window" per
 * market, so N browser refreshes collapse to (at most) one carrier sweep.
 *
 * Only NON-TERMINAL Darb orders are swept (vendor guidance: stop polling once a
 * shipment is completed/returned/cancelled). Each is read by its internal _id
 * (status + real reference) and written via promote_darb_status — refreshing the
 * slug, repairing tracking_number, and promoting orders.status for terminals.
 *
 * Auth via the RLS-scoped client → market isolation. No stock/cost side-effects.
 *
 * Responses:
 *   200 { skipped: true, lastSyncedAt }              — throttled
 *   200 { skipped: false, synced, promoted, notFound } — ran the sweep
 *   401 { error }                                    — unauthenticated
 */

const THROTTLE_SECONDS = 600; // 10 minutes
const CHUNK = 25;
const CONCURRENCY = 3;
const TERMINAL_SLUGS = ["completed", "returned", "cancelled"];

interface OrderRow {
  id: string;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_extra: Record<string, unknown> | null;
  carriers: { code: string } | null;
}

export async function POST(_req: NextRequest) {
  const supabase = await createClient();

  // getActor reads the HMAC-signed oms_profile cookie — zero network calls, and
  // it already carries market_id. The previous auth.getUser() + users lookup
  // cost two round-trips (one to Supabase Auth, one to Postgres) before this
  // route did any work, which is why an app-launch sweep that is usually
  // throttled to a no-op still took ~550-720ms on every agent page load.
  const actorResult = await getActor(_req);
  if ("response" in actorResult) return actorResult.response;
  const marketId = actorResult.actor.market_id;
  if (!marketId) {
    return NextResponse.json({ error: "No market for user" }, { status: 400 });
  }

  // Atomic throttle claim. If another launch synced within the window, skip.
  const { data: claim } = await supabase.rpc("claim_darb_sync", {
    p_market_id: marketId,
    p_throttle_seconds: THROTTLE_SECONDS,
  });
  if (!claim?.claimed) {
    return NextResponse.json(
      { skipped: true, lastSyncedAt: claim?.last_synced_at ?? null },
      { status: 200 },
    );
  }

  // Select NON-TERMINAL Darb orders for the market. Terminal orders (delivered/
  // returned/cancelled) never change carrier-side — don't re-poll them. We gate
  // on the cached slug: anything not in the terminal slug set (incl. NULL) is
  // still in-flight from our projection's POV.
  const { data: orderRows } = await supabase
    .from("orders")
    .select(
      "id, tracking_number, carrier_id, carrier_extra, carriers!orders_carrier_id_fkey!inner(code)",
    )
    .eq("market_id", marketId)
    .eq("carriers.code", "darb_assabil")
    .or(
      `carrier_status_slug.is.null,carrier_status_slug.not.in.(${TERMINAL_SLUGS.join(",")})`,
    );

  const orders = ((orderRows ?? []) as unknown as OrderRow[]).filter(
    (o) => o.carriers?.code === "darb_assabil" && o.carrier_id,
  );

  if (orders.length === 0) {
    return NextResponse.json(
      { skipped: false, synced: 0, promoted: 0, notFound: 0 },
      { status: 200 },
    );
  }

  // Build a config per carrier_id (usually one Darb carrier per market).
  const carrierIds = Array.from(new Set(orders.map((o) => o.carrier_id!).filter(Boolean)));
  const { data: carrierRows } = await supabase
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .in("id", carrierIds);
  const configByCarrierId = new Map<string, ReturnType<typeof buildConfig>>();
  for (const c of (carrierRows ?? []) as unknown as CarrierRow[]) {
    try {
      configByCarrierId.set(c.id, buildConfig(c));
    } catch {
      // skip un-buildable carrier; its orders fall through as not-darb
    }
  }

  let synced = 0;
  let promoted = 0;
  let notFound = 0;
  const adminPromises: Promise<unknown>[] = [];

  // Fetchable: only orders with a usable internal id + config.
  const fetchable = orders
    .map((o) => {
      const internalId =
        typeof o.carrier_extra?.darb_assabil_id === "string"
          ? o.carrier_extra.darb_assabil_id
          : "";
      const config = o.carrier_id ? configByCarrierId.get(o.carrier_id) : undefined;
      return internalId && config ? { order: o, internalId, config } : null;
    })
    .filter((x): x is { order: OrderRow; internalId: string; config: ReturnType<typeof buildConfig> } => !!x);

  const queue = [...fetchable];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await processOne(item);
    }
  }

  async function processOne(item: {
    order: OrderRow;
    internalId: string;
    config: ReturnType<typeof buildConfig>;
  }): Promise<void> {
    const { order, internalId, config } = item;
    const syncedAt = new Date().toISOString();

    let full;
    try {
      full = await fetchDarbShipment(internalId, config);
    } catch {
      return; // transient — leave untouched, next sweep retries
    }

    if (full.kind === "not_found") {
      notFound++;
      await supabase
        .from("orders")
        .update({ carrier_status_synced_at: syncedAt })
        .eq("id", order.id);
      return;
    }

    const res = await supabase.rpc("promote_darb_status", {
      p_order_id: order.id,
      p_slug: full.slug,
      p_reference: full.reference || null,
      p_synced_at: syncedAt,
      p_actor_id: null,
    });
    synced++;
    if (res.data?.promoted) promoted++;

    if (full.slug === null && full.rawStatus.length > 0) {
      adminPromises.push(
        (async () => {
          try {
            const admin = createAdminClient();
            await admin.from("carrier_event_log").insert({
              carrier_code: "darb_assabil",
              source: "tracking_view",
              tracking_number: order.tracking_number,
              order_id: order.id,
              carrier_status_raw: full.rawStatus,
              outcome: "ignored",
              outcome_reason: "unknown_darb_status",
              raw_body: { rawStatus: full.rawStatus },
            });
          } catch {
            // forensic only
          }
        })(),
      );
    }
  }

  // Process in chunks of CHUNK, each chunk with CONCURRENCY workers.
  for (let i = 0; i < fetchable.length; i += CHUNK) {
    queue.length = 0;
    queue.push(...fetchable.slice(i, i + CHUNK));
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
    );
  }
  await Promise.all(adminPromises);

  return NextResponse.json(
    { skipped: false, synced, promoted, notFound },
    { status: 200 },
  );
}
