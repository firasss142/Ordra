import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { manifestRpcErrorResponse } from "@/lib/carriers/manifests/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * « Terminer » a return list. Idempotent. Answers the missing lines; they feed the
 * manager alert `return_missing` and stay scannable on this list.
 * The screen confirms BEFORE calling when lines remain (« Terminer avec N manquants »).
 * Contract: docs/xdelivery-manifests.md.
 */

type Ctx = { params: { id: string } };

async function handlePOST(req: NextRequest, ctx: Ctx) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_return_manifest", {
    p_manifest_id: ctx.params.id,
    p_actor_id: actor.id,
  });
  if (error) return manifestRpcErrorResponse(error, "CLOSE_FAILED");
  return NextResponse.json(data);
}

export const POST = withRouteErrors("/api/warehouse/return-manifests/[id]/close", "POST", handlePOST);
