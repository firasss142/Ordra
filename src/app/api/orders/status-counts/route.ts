import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";

export const dynamic = "force-dynamic";

export interface StatusCounts {
  pending: number;
  confirmed: number;
  uploaded: number;
  rejected: number;
  cancelled: number;
  total: number;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? null
      : actorMarketId;

  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select("status");

  if (marketId) query = query.eq("market_id", marketId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Internal server error", detail: error.message },
      { status: 500 },
    );
  }

  const counts: StatusCounts = {
    pending: 0,
    confirmed: 0,
    uploaded: 0,
    rejected: 0,
    cancelled: 0,
    total: 0,
  };

  for (const row of data ?? []) {
    counts.total++;
    const s = row.status as string;
    if (s === "pending" || s === "attempt_1" || s === "attempt_2" || s === "attempt_3" || s === "callback_scheduled") {
      counts.pending++;
    } else if (s === "confirmed" || s === "dispatch_scheduled") {
      counts.confirmed++;
    } else if (s === "uploaded" || s === "scanned" || s === "dispatched" || s === "deposit" || s === "in_transit") {
      counts.uploaded++;
    } else if (s === "rejected") {
      counts.rejected++;
    } else if (s === "cancelled") {
      counts.cancelled++;
    }
  }

  return NextResponse.json(
    { data: counts },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } },
  );
}
