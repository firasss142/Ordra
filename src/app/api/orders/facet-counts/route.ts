import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { listQuerySchema } from "@/lib/orders/list-filters";
import { searchToLegs } from "@/lib/orders/search-query";

export const dynamic = "force-dynamic";

/**
 * How many orders each facet option would yield.
 *
 * The facet bar named every filter but said nothing about what picking one
 * would return, so narrowing a list meant guessing and backing out of dead
 * ends. Each option now carries its own count.
 *
 * A dimension is counted with every OTHER filter applied but not its own —
 * standard faceted search. Counting the status options while a status filter is
 * active would report the selection back to itself, leaving every unselected
 * option at 0.
 *
 * One RPC, not one query per option: a market with 144 cities and 50 products
 * would otherwise be 200+ round-trips to draw a menu.
 */
export interface FacetCounts {
  /** status → count */
  statuses: Record<string, number>;
  /** agent uuid (or the literal "unassigned") → count */
  agents: Record<string, number>;
  /** city name → count */
  cities: Record<string, number>;
  /** product uuid → count */
  products: Record<string, number>;
  /** carrier uuid → count */
  carriers: Record<string, number>;
}

const EMPTY: FacetCounts = {
  statuses: {},
  agents: {},
  cities: {},
  products: {},
  carriers: {},
};

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const q = parsed.data;

  // Non-super_admin is pinned to their own market whatever the query says; RLS
  // would catch it anyway, but a silently-wrong count is worse than a 403.
  const marketId = actor.role === "super_admin" ? q.market_id ?? null : actorMarketId;
  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const statuses = q.status
    ? q.status.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_order_facet_counts", {
    p_market_id: marketId,
    p_preset: q.preset,
    p_statuses: statuses && statuses.length > 0 ? statuses : null,
    p_agent_id: q.agent_id ?? null,
    p_date_from: q.date_from ?? null,
    p_date_to: q.date_to ?? null,
    p_product_id: q.product_id ?? null,
    p_city: q.city ?? null,
    p_total_min: q.total_min ?? null,
    p_total_max: q.total_max ?? null,
    p_rejection_reason: q.rejection_reason ?? null,
    p_carrier_id: q.carrier_id ?? null,
    p_include_deleted: q.include_deleted,
    p_search_legs: searchToLegs(q.q),
  });

  if (error) {
    return NextResponse.json(
      { error: "Internal server error", detail: error.message },
      { status: 500 },
    );
  }

  const counts = { ...EMPTY, ...((data as Partial<FacetCounts> | null) ?? {}) };

  return NextResponse.json(
    { data: counts },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } },
  );
}
