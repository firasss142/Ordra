import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { summarizeReturnManifests, type ReturnManifestRow } from "@/lib/carriers/manifests/return-view";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * The « Retours » home: return and exchange lists of the last 30 days with their
 * progress, and the totals to receive · missing · set aside.
 * Contract: docs/xdelivery-manifests.md. Read under the caller's RLS — an agent sees
 * their building's lists only, an agent with no building sees nothing.
 *
 * ?warehouse_id= narrows for a manager (an agent is pinned to their own).
 */

const WINDOW_MS = 30 * 86_400_000;

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, { actor, requested: req.nextUrl.searchParams.get("warehouse_id") });
  if (site.unassigned) {
    return NextResponse.json({ manifests: [], totals: { toReceive: 0, missing: 0, setAside: 0, openLists: 0 } });
  }

  let lists = supabase
    .from("carrier_manifests")
    .select("id, kind, carrier_id, code, carrier_created_at, carrier_status, closed_at, warehouse_id, carrier_manifest_parcels ( state, order_id )")
    .in("kind", ["return", "exchange"])
    .gte("carrier_created_at", new Date(Date.now() - WINDOW_MS).toISOString())
    .order("carrier_created_at", { ascending: false });
  let asides = supabase.from("return_set_asides").select("id", { count: "exact", head: true }).is("resolved_at", null);
  if (site.warehouseId) {
    lists = lists.or(`warehouse_id.is.null,warehouse_id.eq.${site.warehouseId}`);
    asides = asides.or(`warehouse_id.is.null,warehouse_id.eq.${site.warehouseId}`);
  }

  const [l, a] = await Promise.all([lists, asides]);
  if (l.error) throw new Error(l.error.message);
  if (a.error) throw new Error(a.error.message);

  const rows = (
    (l.data ?? []) as Array<{
      id: string;
      kind: "return" | "exchange";
      carrier_id: string;
      code: string | null;
      carrier_created_at: string | null;
      carrier_status: string | null;
      closed_at: string | null;
      carrier_manifest_parcels: Array<{ state: string; order_id: string | null }> | null;
    }>
  ).map(
    (r): ReturnManifestRow => ({
      id: r.id,
      kind: r.kind,
      carrierId: r.carrier_id,
      code: r.code,
      createdAt: r.carrier_created_at,
      carrierStatus: r.carrier_status,
      closedAt: r.closed_at,
      lines: (r.carrier_manifest_parcels ?? []).map((x) => ({ state: x.state, orderId: x.order_id })),
    }),
  );

  return NextResponse.json(summarizeReturnManifests(rows, a.count ?? 0));
}

export const GET = withRouteErrors("/api/warehouse/return-manifests", "GET", handleGET);
