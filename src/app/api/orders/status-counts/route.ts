import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * The four work shortcuts above the Commandes list, counted now
 * (prototypes/commandes-v4.html `countTiles`).
 *
 * Each count is the size of the list its tile opens — the predicates are the
 * presets of lib/orders/list-query, restated in get_orders_work_counts. The
 * two hint lines ride along: late callbacks under « À rappeler », and the
 * confirmed orders still waiting under « Téléchargées aujourd'hui ».
 */
export interface WorkCounts {
  today: number;
  unassigned: number;
  recall: number;
  lateCallbacks: number;
  uploadedToday: number;
  toSend: number;
}

interface RpcCounts {
  today: number;
  unassigned: number;
  recall: number;
  late_callbacks: number;
  to_send: number;
  uploaded_today: number;
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") || null : actorMarketId;
  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = (await supabase.rpc("get_orders_work_counts", {
    p_market_id: marketId,
    p_day_start: marketDayStartUtc(todayInMarket(marketId), marketId),
  })) as { data: RpcCounts | null; error: { message?: string } | null };

  if (error || !data) {
    return NextResponse.json({ error: "Internal server error", detail: error?.message ?? "no data" }, { status: 500 });
  }

  const n = (v: unknown) => Number(v ?? 0);
  const counts: WorkCounts = {
    today: n(data.today),
    unassigned: n(data.unassigned),
    recall: n(data.recall),
    lateCallbacks: n(data.late_callbacks),
    uploadedToday: n(data.uploaded_today),
    toSend: n(data.to_send),
  };
  return NextResponse.json({ data: counts }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withRouteErrors("/api/orders/status-counts", "GET", handleGET);
