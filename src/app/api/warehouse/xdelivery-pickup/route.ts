import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import {
  PICKUP_LOG_KIND,
  XDELIVERY_PICKUP_KEY_PREFIX,
  canToggleXDeliveryPickup,
  xdeliveryPickupKey,
} from "@/lib/carriers/xdelivery/pickup";
import {
  buildXDeliveryPickupSites,
  type PickupViewEvent,
  type XDeliveryPickupSite,
} from "@/lib/carriers/xdelivery/pickup-view";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * X-Delivery « Enlèvement » — the per-site switch of the automatic pickup request
 * (owner decision 6, prototypes/xdelivery-v1.html).
 *
 * GET  → the card of every site that ships X-Delivery (the agent's own only).
 * POST → move one site's switch ({ warehouse_id, disabled: boolean }).
 *
 * Same stamp mechanism as Darb's « le chauffeur est passé » (/api/warehouse/pickup),
 * under its own key and its own rule: the agent may turn it back ON. Darb's switch
 * and route are not read or written here.
 */

export type { XDeliveryPickupSite };

type Actor = { id: string; role: string; market_id: string | null };

async function loadSites(req: NextRequest, actor: Actor): Promise<XDeliveryPickupSite[]> {
  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  if (!marketId) return [];
  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) return [];

  const { data: carrierRows } = await supabase
    .from("carriers")
    .select("id, warehouse_id")
    .eq("market_id", marketId)
    .eq("code", "xdelivery")
    .eq("is_active", true);
  const carriers = ((carrierRows ?? []) as Array<{ id: string; warehouse_id: string | null }>)
    .filter((c) => c.warehouse_id && (!site.pinned || c.warehouse_id === site.warehouseId))
    .map((c) => ({ id: c.id, warehouseId: c.warehouse_id as string }));
  if (carriers.length === 0) return [];

  const carrierIds = carriers.map((c) => c.id);
  const siteIds = [...new Set(carriers.map((c) => c.warehouseId))];

  // Service role for two reads the caller may not make themselves, both scoped to what
  // their own client was allowed to see above: `settings` is readable by managers only
  // (a warehouse agent would never see their own press), and carrier_event_log by no one.
  const admin = createAdminClient();
  const [warehouses, settings, orders] = await Promise.all([
    supabase.from("warehouses").select("id, code, name_fr").in("id", siteIds).eq("is_active", true),
    admin
      .from("settings")
      .select("key, value")
      .eq("market_id", marketId)
      .like("key", `${XDELIVERY_PICKUP_KEY_PREFIX}%`),
    supabase
      .from("orders")
      .select("id, carrier_id, tracking_number, customer_city, product_name, quantity, carrier_status_slug")
      .in("carrier_id", carrierIds)
      .eq("status", "scanned")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  const since = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const { data: eventRows } = await admin
    .from("carrier_event_log")
    .select("carrier_id, order_id, outcome, outcome_reason, raw_body, created_at")
    .eq("carrier_code", "xdelivery")
    .in("carrier_id", carrierIds)
    .eq("raw_body->>kind", PICKUP_LOG_KIND)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  const events: PickupViewEvent[] = (
    (eventRows ?? []) as Array<{
      carrier_id: string;
      order_id: string | null;
      outcome: string;
      outcome_reason: string | null;
      raw_body: { count?: number } | null;
      created_at: string;
    }>
  ).map((e) => ({
    carrierId: e.carrier_id,
    orderId: e.order_id,
    reason: e.outcome_reason,
    outcome: e.outcome,
    count: Number(e.raw_body?.count ?? 0),
    at: e.created_at,
  }));

  return buildXDeliveryPickupSites({
    marketId,
    now: new Date(),
    actor: { role: actor.role, siteId: site.warehouseId },
    // Tunisia: the building's name is the French one.
    sites: ((warehouses.data ?? []) as Array<{ id: string; code: string; name_fr: string }>).map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name_fr,
    })),
    carriers,
    settings: Object.fromEntries(
      ((settings.data ?? []) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value]),
    ),
    parcels: (
      (orders.data ?? []) as Array<{
        id: string;
        carrier_id: string;
        tracking_number: string | null;
        customer_city: string | null;
        product_name: string | null;
        quantity: number | null;
        carrier_status_slug: string | null;
      }>
    ).map((o) => ({
      orderId: o.id,
      carrierId: o.carrier_id,
      tracking: o.tracking_number,
      city: o.customer_city,
      product: o.product_name,
      quantity: o.quantity,
      slug: o.carrier_status_slug,
    })),
    events,
  });
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ sites: await loadSites(req, actor) });
}

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { warehouse_id?: unknown; disabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const warehouseId = typeof body.warehouse_id === "string" ? body.warehouse_id : "";
  const disabled = body.disabled;
  if (!warehouseId || typeof disabled !== "boolean") {
    return NextResponse.json({ error: "warehouse_id and disabled are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  if (!marketId) return NextResponse.json({ error: "market_required" }, { status: 400 });

  const { data: warehouse } = await supabase
    .from("warehouses")
    .select("id, market_id, is_active")
    .eq("id", warehouseId)
    .maybeSingle<{ id: string; market_id: string; is_active: boolean }>();
  if (!warehouse || !warehouse.is_active || warehouse.market_id !== marketId) {
    return NextResponse.json({ error: "unknown_site" }, { status: 404 });
  }

  // A switch with nothing behind it would be a stamp nobody reads.
  const { data: account } = await supabase
    .from("carriers")
    .select("id")
    .eq("market_id", marketId)
    .eq("code", "xdelivery")
    .eq("is_active", true)
    .eq("warehouse_id", warehouseId)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!account) return NextResponse.json({ error: "no_xdelivery_account" }, { status: 404 });

  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (!canToggleXDeliveryPickup({ role: actor.role, actorSiteId: site.warehouseId, targetSiteId: warehouseId })) {
    return NextResponse.json({ error: "forbidden_site" }, { status: 403 });
  }

  // Service role: a warehouse agent has no write policy on `settings`, and must not
  // get one for the whole table to press this. Authorisation is decided above.
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("settings")
    .upsert(
      {
        market_id: marketId,
        key: xdeliveryPickupKey(warehouseId),
        // ON erases the stamp: the absence of a press IS the default.
        value: disabled ? { disabled_at: now, by: actor.id } : {},
        updated_by: actor.id,
        updated_at: now,
      },
      { onConflict: "market_id,key" },
    );
  if (error) {
    console.error("[POST /api/warehouse/xdelivery-pickup] upsert failed", { warehouseId, code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ sites: await loadSites(req, actor) });
}

export const GET = withRouteErrors("/api/warehouse/xdelivery-pickup", "GET", handleGET);
export const POST = withRouteErrors("/api/warehouse/xdelivery-pickup", "POST", handlePOST);
