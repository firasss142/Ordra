import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { manifestRpcErrorResponse, normalizeScannedCode } from "@/lib/carriers/manifests/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * One scan on an open return list: { code } = their parcel barcode OR our QR.
 * Everything is decided by `scan_manifest_return` (good condition by default, stock
 * back once, set aside when off the list). The `result` values and refusal codes
 * are listed in docs/xdelivery-manifests.md.
 */

type Ctx = { params: { id: string } };

async function handlePOST(req: NextRequest, ctx: Ctx) {
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

  // The caller's own session: the RPC checks that the actor IS the session.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("scan_manifest_return", {
    p_manifest_id: ctx.params.id,
    p_code: code,
    p_actor_id: actor.id,
  });
  if (error) return manifestRpcErrorResponse(error, "SCAN_FAILED");
  return NextResponse.json(data);
}

export const POST = withRouteErrors("/api/warehouse/return-manifests/[id]/scan", "POST", handlePOST);
