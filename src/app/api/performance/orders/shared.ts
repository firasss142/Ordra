// Shared by GET /api/performance/orders and /drill: who may read, which market,
// and the facts of the request. Money goes to super_admin only (the owner);
// a market manager reads the same page without a single price.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { marketTimezone } from "@/lib/markets";
import { parseState } from "@/lib/performance/orders/query";
import { loadPerformance } from "@/lib/performance/orders/load";
import type { BuildInput } from "@/lib/performance/orders/build";

const READERS = new Set(["super_admin", "market_manager"]);

export async function readRequest(req: NextRequest): Promise<{ input: BuildInput } | { response: NextResponse }> {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return { response: actorResult.response };
  const { actor } = actorResult;
  if (!READERS.has(actor.role)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  // super_admin names the market; a manager is pinned to their own whatever
  // they send. The RPC enforces the same rule a second time in SQL.
  const marketId = actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId) return { response: NextResponse.json({ error: "market_id is required" }, { status: 400 }) };

  const supabase = await createClient();
  const input = await loadPerformance(
    supabase as unknown as Parameters<typeof loadPerformance>[0],
    marketId,
    marketTimezone(marketId),
    parseState(req.nextUrl.searchParams),
    actor.role === "super_admin",
  );
  return { input };
}

export const PRIVATE_CACHE = { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" };
