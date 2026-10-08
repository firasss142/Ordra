import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { canManageXDeliveryPickup, requestPickupBatch } from "@/lib/carriers/xdelivery/pickup";
import { buildXDeliveryPickupSites, type PickupViewInput, type XDeliveryPickupSite } from "@/lib/carriers/xdelivery/pickup-view";
import { buildPickupBatchDeps, loadXDeliveryPortalAccounts } from "@/lib/carriers/xdelivery/production";
import { XDeliveryPortal } from "@/lib/carriers/xdelivery/portal";
import { pickupErrorResponse } from "@/lib/carriers/manifests/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * X-Delivery « Demande d'enlèvement » — on demand, by batch (owner, 2026-10-08).
 * Contract: docs/xdelivery-manifests.md. Undo: ./[manifestId]/route.ts.
 *
 * GET  → per building that ships X-Delivery (the agent's own only): the scanned
 *        parcels waiting, the lists sent in the last 3 days, the lists undone.
 * POST → { warehouse_id, order_ids } sends those parcels as ONE list at X-Delivery.
 *
 * There is no switch and no automatic request any more: the poll only imports the
 * lists and follows an undo made on their portal (manifest-sync.ts).
 */

export type { XDeliveryPickupSite };

type Actor = { id: string; role: string; market_id: string | null };

const LIST_WINDOW_MS = 3 * 86_400_000;
const MAX_ORDERS = 500;

async function loadSites(req: NextRequest, actor: Actor): Promise<XDeliveryPickupSite[]> {
  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  if (!marketId) return [];
  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) return [];

  // Service role for the credentials only (the portal login decides `hasPortalLogin`);
  // every row shown below is read with the caller's own client, under RLS.
  const accounts = (await loadXDeliveryPortalAccounts(createAdminClient())).filter(
    (a) => a.marketId === marketId && a.warehouseId && (!site.pinned || a.warehouseId === site.warehouseId),
  );
  if (accounts.length === 0) return [];
  const carrierIds = accounts.map((a) => a.carrierId);
  const siteIds = [...new Set(accounts.map((a) => a.warehouseId as string))];

  const [warehouses, orders, lists] = await Promise.all([
    supabase.from("warehouses").select("id, code, name_fr").in("id", siteIds).eq("is_active", true),
    supabase
      .from("orders")
      .select("id, carrier_id, tracking_number, customer_city, product_name, quantity")
      .in("carrier_id", carrierIds)
      .eq("status", "scanned")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(MAX_ORDERS),
    supabase
      .from("carrier_manifests")
      .select(
        "id, carrier_id, carrier_created_at, requested_by, carrier_status, deleted_at, deleted_source, carrier_manifest_parcels ( id, order_id, barcode, state )",
      )
      .eq("kind", "pickup")
      .in("carrier_id", carrierIds)
      .gte("carrier_created_at", new Date(Date.now() - LIST_WINDOW_MS).toISOString())
      .order("carrier_created_at", { ascending: false }),
  ]);
  for (const r of [warehouses, orders, lists]) if (r.error) throw new Error(r.error.message);

  return buildXDeliveryPickupSites({
    actor: { role: actor.role, siteId: site.warehouseId },
    // Tunisia: the building's name is the French one.
    sites: ((warehouses.data ?? []) as Array<{ id: string; code: string; name_fr: string }>).map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name_fr,
    })),
    accounts: accounts.map((a) => ({
      carrierId: a.carrierId,
      warehouseId: a.warehouseId as string,
      hasPortalLogin: a.login !== null,
    })),
    scanned: (
      (orders.data ?? []) as Array<{
        id: string;
        carrier_id: string;
        tracking_number: string | null;
        customer_city: string | null;
        product_name: string | null;
        quantity: number | null;
      }>
    ).map((o) => ({
      orderId: o.id,
      carrierId: o.carrier_id,
      tracking: o.tracking_number,
      city: o.customer_city,
      product: o.product_name,
      quantity: o.quantity,
    })),
    lists: (
      (lists.data ?? []) as Array<{
        id: string;
        carrier_id: string;
        carrier_created_at: string | null;
        requested_by: string | null;
        carrier_status: string | null;
        deleted_at: string | null;
        deleted_source: "ordra" | "carrier" | null;
        carrier_manifest_parcels: Array<{ id: string; order_id: string | null; barcode: string; state: string }> | null;
      }>
    ).map(
      (l): PickupViewInput["lists"][number] => ({
        id: l.id,
        carrierId: l.carrier_id,
        createdAt: l.carrier_created_at,
        requestedBy: l.requested_by,
        carrierStatus: l.carrier_status,
        deletedAt: l.deleted_at,
        deletedSource: l.deleted_source,
        lines: (l.carrier_manifest_parcels ?? []).map((x) => ({
          lineId: x.id,
          orderId: x.order_id,
          barcode: x.barcode,
          state: x.state,
        })),
      }),
    ),
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

  let body: { warehouse_id?: unknown; order_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error_code: "INVALID_JSON" }, { status: 400 });
  }
  const warehouseId = typeof body.warehouse_id === "string" ? body.warehouse_id : "";
  const orderIds = Array.isArray(body.order_ids)
    ? [...new Set(body.order_ids.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  if (!warehouseId || orderIds.length === 0) {
    return NextResponse.json({ error_code: "BAD_REQUEST", message: "warehouse_id and order_ids are required" }, { status: 400 });
  }
  if (orderIds.length > MAX_ORDERS) {
    return NextResponse.json({ error_code: "TOO_MANY", message: `${MAX_ORDERS} colis au plus par liste` }, { status: 400 });
  }

  const { marketId } = resolveWarehouseScope(req, actor);
  if (!marketId) return NextResponse.json({ error_code: "MARKET_REQUIRED" }, { status: 400 });

  const admin = createAdminClient();
  const account = (await loadXDeliveryPortalAccounts(admin)).find(
    (a) => a.marketId === marketId && a.warehouseId === warehouseId,
  );
  if (!account) return NextResponse.json({ error_code: "NO_XDELIVERY_ACCOUNT" }, { status: 404 });

  const site = await resolveSiteFilter(await createClient(), { actor, requested: null });
  if (!canManageXDeliveryPickup({ role: actor.role, actorSiteId: site.warehouseId, targetSiteId: warehouseId })) {
    return NextResponse.json({ error_code: "WRONG_SITE" }, { status: 403 });
  }
  if (!account.login) {
    return NextResponse.json(
      { error_code: "NO_PORTAL_LOGIN", message: "Identifiants du portail X-Delivery absents (Connexions → Transporteurs)" },
      { status: 409 },
    );
  }

  try {
    const portal = new XDeliveryPortal(account.login);
    const result = await requestPickupBatch(buildPickupBatchDeps(admin, account, portal), {
      carrierId: account.carrierId,
      orderIds,
      actorId: actor.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    return pickupErrorResponse(err);
  }
}

export const GET = withRouteErrors("/api/warehouse/xdelivery-pickup", "GET", handleGET);
export const POST = withRouteErrors("/api/warehouse/xdelivery-pickup", "POST", handlePOST);
