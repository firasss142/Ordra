import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { refreshManifestsFor } from "@/lib/carriers/manifests/refresh";
import { UUID_RE, normalizeScannedCode } from "@/lib/carriers/manifests/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Open a return list by SCANNING — { code } → { manifest_id, matched }.
 *
 *   1. The sheet's barcode (the list's `code`)            → matched: "sheet"
 *   2. Any parcel on a list: their barcode or our QR      → matched: "parcel"
 *      (the newest list holding it — the agent may scan a box before the sheet)
 *   3. Nothing known: fetch the lists now, then try 1–2 once more. The driver can
 *      arrive before the 10-minute poll has seen today's list.
 *
 * Read under the caller's RLS: a list of another building is never found.
 * Contract: docs/xdelivery-manifests.md.
 */

type Supa = Awaited<ReturnType<typeof createClient>>;

async function find(supabase: Supa, code: string): Promise<{ manifest_id: string; matched: "sheet" | "parcel" } | null> {
  const { data: sheet, error } = await supabase
    .from("carrier_manifests")
    .select("id")
    .eq("code", code)
    .in("kind", ["return", "exchange"])
    .order("carrier_created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  if (sheet && sheet.length > 0) return { manifest_id: (sheet[0] as { id: string }).id, matched: "sheet" };

  let lines = supabase
    .from("carrier_manifest_parcels")
    .select("manifest_id, created_at, carrier_manifests!inner ( kind )")
    .in("carrier_manifests.kind", ["return", "exchange"])
    .order("created_at", { ascending: false })
    .limit(1);
  lines = UUID_RE.test(code) ? lines.eq("order_id", code.toLowerCase()) : lines.eq("barcode", code);
  const { data: line, error: lErr } = await lines;
  if (lErr) throw new Error(lErr.message);
  if (line && line.length > 0) return { manifest_id: (line[0] as { manifest_id: string }).manifest_id, matched: "parcel" };
  return null;
}

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error_code: "INVALID_JSON" }, { status: 400 });
  }
  const code = normalizeScannedCode(body.code);
  if (!code) return NextResponse.json({ error_code: "BAD_CODE" }, { status: 400 });

  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) return NextResponse.json({ error_code: "NO_SITE_ASSIGNED" }, { status: 403 });

  const hit = await find(supabase, code);
  if (hit) return NextResponse.json(hit);

  const { marketId } = resolveWarehouseScope(req, actor);
  if (marketId) {
    await refreshManifestsFor(createAdminClient(), { marketId, warehouseId: site.warehouseId });
    const again = await find(supabase, code);
    if (again) return NextResponse.json(again);
  }
  return NextResponse.json(
    { error_code: "MANIFEST_NOT_FOUND", message: "Aucune liste retour pour ce code" },
    { status: 404 },
  );
}

export const POST = withRouteErrors("/api/warehouse/return-manifests/open", "POST", handlePOST);
