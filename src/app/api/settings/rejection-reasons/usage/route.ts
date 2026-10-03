import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/rejection-reasons/usage?market_id=
 *
 * How many of the market's orders carry each sub-reason — shown beside every
 * reason in Réglages › Motifs de rejet, and the same count the delete rule
 * reads (used → retired, never used → deleted).
 *
 * super_admin or market_manager (own market). Response: { data: { [key]: n } }
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const queryMarketId = req.nextUrl.searchParams.get("market_id");
  let marketId: string;
  if (actor.role === "super_admin") {
    if (!queryMarketId) {
      return NextResponse.json({ error: "market_id is required for super_admin" }, { status: 400 });
    }
    marketId = queryMarketId;
  } else {
    if (!actor.market_id || (queryMarketId && queryMarketId !== actor.market_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    marketId = actor.market_id;
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("rejection_reason_configs")
    .select("key, parent_key")
    .eq("market_id", marketId);
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const keys = ((rows ?? []) as { key: string; parent_key: string | null }[])
    .filter((r) => r.parent_key !== null)
    .map((r) => r.key);

  const counts = await Promise.all(
    keys.map(async (key) => {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("market_id", marketId)
        .eq("rejection_subreason", key);
      return [key, count ?? 0] as const;
    }),
  );

  return NextResponse.json({ data: Object.fromEntries(counts) });
}

export const GET = withRouteErrors("/api/settings/rejection-reasons/usage", "GET", handleGET);
