import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canReadCarrierPerformance } from "@/lib/settings-permissions";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * Per carrier over the last 30 days, read from get_carrier_delivery_performance —
 * the ONE outcome definition (carrier_parcel_outcome): a Darb parcel cancelled
 * after pickup is a failure, not a parcel that never happened. The route used to
 * count only `returned` on order_history, which put Darb at 92–100 % (truth ~52 %).
 */
export interface CarrierPerfRow {
  carrier_id: string;
  delivered: number;
  failed: number;
  delivery_rate_30d: number | null;
  /** Median hours from pickup (or upload) to delivered. */
  median_transit_hours: number | null;
  sample_size: number;
}

export interface CarrierPerfResponse {
  data: CarrierPerfRow[];
}

interface RpcRow {
  carrier_id: string;
  delivered: number | string;
  failed: number | string;
  median_transit_hours: number | string | null;
  sample_size: number | string;
}

async function handleGET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const marketId =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "";

  if (!canReadCarrierPerformance(role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  const { data: rows, error } = await supabase.rpc("get_carrier_delivery_performance", {
    p_market_id: marketId,
    p_days: WINDOW_DAYS,
  });
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const data: CarrierPerfRow[] = ((rows ?? []) as RpcRow[]).map((r) => {
    const delivered = Number(r.delivered);
    const failed = Number(r.failed);
    const total = delivered + failed;
    return {
      carrier_id: r.carrier_id,
      delivered,
      failed,
      delivery_rate_30d: total > 0 ? delivered / total : null,
      median_transit_hours: r.median_transit_hours == null ? null : Number(r.median_transit_hours),
      sample_size: Number(r.sample_size),
    };
  });

  const body: CarrierPerfResponse = { data };
  return NextResponse.json(body);
}

export const GET = withRouteErrors("/api/carriers/performance", "GET", handleGET);
