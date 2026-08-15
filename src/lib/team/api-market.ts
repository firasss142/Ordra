import { NextResponse } from "next/server";
import type { Actor } from "@/lib/auth/actor";
import { marketTimezone } from "@/lib/markets";

/**
 * Resolve the market a team API call is about.
 *
 * super_admin must say which market (`market_id`) — the pages always pass the
 * scoped one, and "all markets" is meaningless for a roster. Everyone else is
 * pinned to their own market whatever they send; the RPCs enforce the same
 * rule a second time in SQL. Agents never reach these routes.
 */
export function resolveTeamMarket(
  actor: Actor,
  marketParam: string | null,
): { marketId: string; tz: string } | { response: NextResponse } {
  if (actor.role === "agent") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const marketId = actor.role === "super_admin" ? marketParam : actor.market_id;
  if (!marketId) {
    return { response: NextResponse.json({ error: "market_id is required" }, { status: 400 }) };
  }
  return { marketId, tz: marketTimezone(marketId) };
}
