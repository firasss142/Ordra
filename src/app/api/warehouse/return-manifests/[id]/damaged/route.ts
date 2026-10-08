import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { RETURN_REASONS, manifestRpcErrorResponse } from "@/lib/carriers/manifests/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * « Endommagé » on a parcel already scanned on this list:
 * { parcel_id, return_reason, note? }. One way, only while the list is open —
 * `mark_manifest_return_damaged` appends the correction to the ledger.
 * Contract: docs/xdelivery-manifests.md.
 */

type Ctx = { params: { id: string } };

async function handlePOST(req: NextRequest, _ctx: Ctx) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { parcel_id?: unknown; return_reason?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error_code: "INVALID_JSON" }, { status: 400 });
  }
  const parcelId = typeof body.parcel_id === "string" ? body.parcel_id : "";
  const reason = typeof body.return_reason === "string" ? body.return_reason : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!parcelId) return NextResponse.json({ error_code: "BAD_REQUEST", message: "parcel_id is required" }, { status: 400 });
  if (!(RETURN_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json({ error_code: "REASON_REQUIRED" }, { status: 400 });
  }
  if (reason === "other" && !note) return NextResponse.json({ error_code: "NOTE_REQUIRED" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_manifest_return_damaged", {
    p_parcel_id: parcelId,
    p_actor_id: actor.id,
    p_return_reason: reason,
    p_note: note || null,
  });
  if (error) return manifestRpcErrorResponse(error, "DAMAGED_FAILED");
  return NextResponse.json(data);
}

export const POST = withRouteErrors("/api/warehouse/return-manifests/[id]/damaged", "POST", handlePOST);
