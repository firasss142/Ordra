import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { refreshManifestsFor } from "@/lib/carriers/manifests/refresh";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * « Actualiser » — fetch the lists now instead of waiting for the 10-minute poll.
 * Only the caller's market and, for an agent, their own building's account.
 * Contract: docs/xdelivery-manifests.md.
 */

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { marketId } = resolveWarehouseScope(req, actor);
  if (!marketId) return NextResponse.json({ error_code: "MARKET_REQUIRED" }, { status: 400 });
  const site = await resolveSiteFilter(await createClient(), { actor, requested: null });
  if (site.unassigned) return NextResponse.json({ error_code: "NO_SITE_ASSIGNED" }, { status: 403 });

  const result = await refreshManifestsFor(createAdminClient(), { marketId, warehouseId: site.warehouseId });
  return NextResponse.json(result);
}

export const POST = withRouteErrors("/api/warehouse/return-manifests/refresh", "POST", handlePOST);
