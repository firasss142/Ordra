import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";

export const dynamic = "force-dynamic";

/**
 * The buildings this market works out of, and which one the caller stands in.
 *
 * Libya has two — Tripoli and Benghazi — one per Darb Assabil account, and they
 * hold separate stock. Every warehouse screen needs to name the site it is
 * showing, so the answer lives in one small route rather than being re-derived
 * on each page.
 */

export interface WarehouseSite {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export interface WarehouseSitesResponse {
  sites: WarehouseSite[];
  /** The caller's own building, when they have one. */
  mine: string | null;
  /** True when the caller cannot look at another site. */
  pinned: boolean;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { marketId, marketCode } = resolveWarehouseScope(req, actor);
  const site = await resolveSiteFilter(supabase, { actor, requested: null });

  let query = supabase
    .from("warehouses")
    .select("id, code, name_fr, name_ar, is_default")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("code", { ascending: true });
  if (marketId) query = query.eq("market_id", marketId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    code: string;
    name_fr: string;
    name_ar: string;
    is_default: boolean;
  }>;

  const body: WarehouseSitesResponse = {
    // Libya reads Arabic, Tunisia French. The site name is a place name and has
    // to match what is painted on the building, so it is not translated by key.
    sites: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: marketCode === "ly" ? r.name_ar : r.name_fr,
      isDefault: r.is_default,
    })),
    mine: site.warehouseId,
    pinned: site.pinned,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
  });
}
