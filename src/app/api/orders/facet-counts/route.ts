import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { csvList, listQuerySchema } from "@/lib/orders/list-filters";
import { searchToLegs } from "@/lib/orders/search-query";
import { marketDayBounds, marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import { readArchiveAfterDays } from "@/lib/orders/list-context";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * How many orders each value of the filter line would yield — the number next
 * to every option of Statut · Agent · Boutique · Plus de filtres.
 *
 * A dimension is counted with every OTHER filter applied but not its own, so an
 * unpicked option says what picking it would add. One RPC
 * (get_order_facet_counts_v2), whose scope and predicates restate
 * lib/orders/list-query so a count never disagrees with the list it opens.
 */
export interface FacetCounts {
  statuses: Record<string, number>;
  /** agent uuid, or "unassigned" */
  agents: Record<string, number>;
  storefronts: Record<string, number>;
  /** city name, or "none" */
  cities: Record<string, number>;
  products: Record<string, number>;
  /** carrier uuid, or "none" */
  carriers: Record<string, number>;
}

const EMPTY: FacetCounts = { statuses: {}, agents: {}, storefronts: {}, cities: {}, products: {}, carriers: {} };

const listOrNull = (raw: string | undefined) => {
  const v = csvList(raw);
  return v.length ? v : null;
};

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  const q = parsed.data;

  const marketId = actor.role === "super_admin" ? q.market_id ?? null : actorMarketId;
  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const window = marketDayBounds(q.date_from ?? null, q.date_to ?? null, marketId);
  const archiveDays = q.scope === "archive" && q.state !== "deleted" ? await readArchiveAfterDays(supabase, marketId) : null;

  const { data, error } = await supabase.rpc("get_order_facet_counts_v2", {
    p_market_id: marketId,
    p_scope: q.scope,
    p_state: q.state,
    p_archive_cutoff: archiveDays === null ? null : new Date(Date.now() - archiveDays * 86_400_000).toISOString(),
    p_preset: q.preset,
    p_day_start: marketDayStartUtc(todayInMarket(marketId), marketId),
    p_statuses: listOrNull(q.status),
    p_agents: listOrNull(q.agent_id),
    p_storefronts: listOrNull(q.storefront_id),
    p_cities: listOrNull(q.city),
    p_products: listOrNull(q.product_id),
    p_carriers: listOrNull(q.carrier_id),
    p_date_from: window.fromIso,
    p_date_to: window.toIso,
    p_search_legs: searchToLegs(q.q),
  });

  if (error) {
    return NextResponse.json({ error: "Internal server error", detail: error.message }, { status: 500 });
  }

  const counts = { ...EMPTY, ...((data as Partial<FacetCounts> | null) ?? {}) };
  return NextResponse.json({ data: counts }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withRouteErrors("/api/orders/facet-counts", "GET", handleGET);
