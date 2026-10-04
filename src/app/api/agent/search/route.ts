import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/server";
import { MARKET_SEARCH_MIN, searchMarketOrders } from "@/lib/agent-search/market";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/agent/search?q=… — the agent's search over their whole market.
 *
 * Agents only (managers search from the Orders page). The service-role client
 * reads past the agent's RLS, so the market comes from the session and nothing
 * else; see lib/agent-search/market for what is returned and why it is narrow.
 */
async function handleGET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;

  if (actor.role !== "agent" || !actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MARKET_SEARCH_MIN) {
    return NextResponse.json(
      { error: `Query must be at least ${MARKET_SEARCH_MIN} characters` },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const data = await searchMarketOrders(createAdminClient(), {
      marketId: actor.market_id,
      meId: actor.id,
      raw: q,
    });
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[agent/search]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = withRouteErrors("/api/agent/search", "GET", handleGET);
