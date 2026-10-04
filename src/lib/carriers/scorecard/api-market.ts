import { NextResponse } from "next/server";
import type { Actor } from "@/lib/auth/actor";

/**
 * The market a Transporteurs call is about. The page is for the owner and the
 * market managers (decision 2026-10-03): agents and warehouse agents get 403.
 * super_admin must name the market; a market_manager is pinned to their own
 * whatever they send. The RPCs check the same rule again in SQL.
 */
export function resolveScorecardMarket(
  actor: Actor,
  marketParam: string | null,
): { marketId: string } | { response: NextResponse } {
  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const marketId = actor.role === "super_admin" ? marketParam : actor.market_id;
  if (!marketId) {
    return { response: NextResponse.json({ error: "market_id is required" }, { status: 400 }) };
  }
  return { marketId };
}
