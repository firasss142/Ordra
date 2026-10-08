import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { canManageXDeliveryPickup, releaseFromPickup } from "@/lib/carriers/xdelivery/pickup";
import { buildReleaseDeps, loadXDeliveryPortalAccounts } from "@/lib/carriers/xdelivery/production";
import { XDeliveryPortal } from "@/lib/carriers/xdelivery/portal";
import { pickupErrorResponse } from "@/lib/carriers/manifests/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Undo a pickup list (owner, 2026-10-08). Contract: docs/xdelivery-manifests.md.
 *
 * DELETE                     → the whole list goes (their DELETE).
 * PATCH { order_ids: [...] } → only these parcels leave it (their remove-parcels).
 *
 * Either way the orders X-Delivery then holds as CREATED go back to `uploaded`,
 * stock restored (`release_pickup_parcel`). The answer lists what moved and what
 * did not, with the reason — a parcel the driver already took cannot come back.
 */

type Ctx = { params: { manifestId: string } };

async function undo(req: NextRequest, ctx: Ctx, orderIds: string[] | "all") {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The caller's own client: RLS decides whether they may see this list at all.
  const supabase = await createClient();
  const { data: manifest } = await supabase
    .from("carrier_manifests")
    .select("id, carrier_id, market_id, warehouse_id, kind")
    .eq("id", ctx.params.manifestId)
    .maybeSingle<{ id: string; carrier_id: string; market_id: string; warehouse_id: string | null; kind: string }>();
  if (!manifest) return NextResponse.json({ error_code: "MANIFEST_NOT_FOUND" }, { status: 404 });
  if (actor.role !== "super_admin" && manifest.market_id !== actor.market_id) {
    return NextResponse.json({ error_code: "MANIFEST_NOT_FOUND" }, { status: 404 });
  }

  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (!canManageXDeliveryPickup({ role: actor.role, actorSiteId: site.warehouseId, targetSiteId: manifest.warehouse_id })) {
    return NextResponse.json({ error_code: "WRONG_SITE" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [account] = await loadXDeliveryPortalAccounts(admin, [manifest.carrier_id]);
  if (!account) return NextResponse.json({ error_code: "NO_XDELIVERY_ACCOUNT" }, { status: 404 });
  if (!account.login) {
    return NextResponse.json(
      { error_code: "NO_PORTAL_LOGIN", message: "Identifiants du portail X-Delivery absents (Connexions → Transporteurs)" },
      { status: 409 },
    );
  }

  try {
    const result = await releaseFromPickup(buildReleaseDeps(admin, account, new XDeliveryPortal(account.login)), {
      manifestId: manifest.id,
      orderIds,
      actorId: actor.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    return pickupErrorResponse(err);
  }
}

async function handleDELETE(req: NextRequest, ctx: Ctx) {
  return undo(req, ctx, "all");
}

async function handlePATCH(req: NextRequest, ctx: Ctx) {
  let body: { order_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error_code: "INVALID_JSON" }, { status: 400 });
  }
  const orderIds = Array.isArray(body.order_ids)
    ? [...new Set(body.order_ids.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  if (orderIds.length === 0) {
    return NextResponse.json({ error_code: "BAD_REQUEST", message: "order_ids is required" }, { status: 400 });
  }
  return undo(req, ctx, orderIds);
}

export const DELETE = withRouteErrors("/api/warehouse/xdelivery-pickup/[manifestId]", "DELETE", handleDELETE);
export const PATCH = withRouteErrors("/api/warehouse/xdelivery-pickup/[manifestId]", "PATCH", handlePATCH);
