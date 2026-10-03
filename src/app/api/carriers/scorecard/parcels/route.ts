import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveScorecardMarket } from "@/lib/carriers/scorecard/api-market";
import type { ParcelKind, ScorecardParcel } from "@/lib/carriers/scorecard/types";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const KINDS: readonly ParcelKind[] = ["late", "returns", "dormant"];

/**
 * GET /api/carriers/scorecard/parcels?market_id=…&carrier_id=…&kind=late|returns|dormant
 * The parcels behind a Transporteurs number, oldest first (`get_carrier_scorecard_parcels`).
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const params = req.nextUrl.searchParams;
  const scope = resolveScorecardMarket(actorResult.actor, params.get("market_id"));
  if ("response" in scope) return scope.response;

  const carrierId = params.get("carrier_id");
  const kind = params.get("kind") as ParcelKind | null;
  if (!carrierId || !kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "carrier_id and kind (late|returns|dormant) are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_carrier_scorecard_parcels", {
    p_market_id: scope.marketId,
    p_carrier_id: carrierId,
    p_kind: kind,
  });

  if (error) {
    console.error("[api/carriers/scorecard/parcels] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: (data ?? []) as ScorecardParcel[] });
}

export const GET = withRouteErrors("/api/carriers/scorecard/parcels", "GET", handleGET);
