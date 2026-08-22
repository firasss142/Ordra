import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { computeCrossMarketMetrics } from "@/lib/cross-market-metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics/cross-market — the Système › Marchés cards.
 *
 * Returns one rich metrics object per market (7-day + 30-day funnels, today's
 * orders, delivery rate, agents online/active, connection counts, last order).
 * super_admin only: Marchés is a cross-market view and editing a market is a
 * cross-market action. RLS returns every market for super_admin, so no
 * market filter is applied.
 *
 * Before this route existed the workspace fetched a 404 and every card fell
 * back to zero — the "all values are 0" bug. The heavy lifting is a pure,
 * unit-tested function; here we just gather rows and hand them over.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const cut30dIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [marketsRes, ordersRes, agentsRes, sfRes, caRes] = await Promise.all([
    supabase.from("markets").select("id, code, name").eq("is_active", true).order("code"),
    supabase
      .from("orders")
      .select("market_id, status, created_at")
      .gte("created_at", cut30dIso)
      .limit(50000),
    supabase
      .from("users")
      .select("market_id, is_active, last_seen_at")
      .in("role", ["agent", "market_manager"]),
    supabase.from("storefronts").select("market_id, is_active"),
    supabase.from("carriers").select("market_id, is_active"),
  ]);

  if (marketsRes.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const markets = (marketsRes.data ?? []) as { id: string; code: string; name: string }[];
  const metrics = computeCrossMarketMetrics({
    now,
    marketIds: markets.map((m) => m.id),
    orders: (ordersRes.data ?? []) as { market_id: string; status: string; created_at: string }[],
    agents: (agentsRes.data ?? []) as { market_id: string; is_active: boolean; last_seen_at: string | null }[],
    storefronts: (sfRes.data ?? []) as { market_id: string; is_active: boolean }[],
    carriers: (caRes.data ?? []) as { market_id: string; is_active: boolean }[],
  });

  return NextResponse.json({ data: metrics });
}
