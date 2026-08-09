// GET /api/products/list — the /products page's single data source.
//
// Split from /api/products (the same way /api/orders/list is split from
// /api/orders) so that the order-creation picker, the mappings page and the
// lead modals never pay for a profitability aggregation, and so the column-
// projection fix could ship on its own.
//
// ── WHY EVERYTHING HAPPENS IN ONE FUNCTION BODY ───────────────────────────
// The bug being fixed: the page filtered and sorted client-side over 25 rows
// while `total` came from Postgres, so "Stock bas" only found low stock on page
// 1 and the range label contradicted the total. Splitting the work between SQL
// and Node means two definitions of `total`. Here the enrich → count → filter →
// sort → slice sequence runs over ONE array, so
//     facets[filter] === pagination.total
// holds by construction, and the test suite asserts it for every facet.
//
// This reads the whole market catalogue into memory. That is deliberate and
// bounded: the cost axis is order volume (already paid today), not catalogue
// size. Promote the aggregation — not the formula — into SQL when a single
// market passes ~2000 products or the 30-day window exceeds ~1.5s p95.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewProductProfitability } from "@/lib/finance-permissions";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadProductPeriodMetrics, type MetricsClient } from "@/lib/products/metrics";
import {
  applyFacet,
  computeFacetCounts,
  computeHighlights,
  computeStockSplit,
  parseProductListQuery,
  sortRows,
} from "@/lib/products/list-filters";
import type {
  ProductListResponse,
  ProductListRow,
  ProductPeriodMetrics,
} from "@/types/product-list";

export const dynamic = "force-dynamic";

/** Mirrors the widened product_inventory_view (20260824000001). Never "*". */
const VIEW_COLUMNS = [
  "id",
  "market_id",
  "name",
  "sku",
  "image_url",
  "unit_cogs",
  "packing_cost",
  "confirmation_processing_cost",
  "default_price",
  "initial_stock",
  "current_stock",
  "system_inventory",
  "real_inventory",
  "low_stock_threshold",
  "damaged_return_count",
  "is_active",
].join(", ");

type RawViewRow = Record<string, unknown> & {
  id: string;
  product_variants?: { count: number }[];
};

function toListRow(raw: RawViewRow, metrics: ProductPeriodMetrics | null): ProductListRow {
  const { product_variants, ...rest } = raw;
  const n = (v: unknown, dflt = 0) => (v === null || v === undefined ? dflt : Number(v));
  return {
    id: String(rest.id),
    market_id: String(rest.market_id ?? ""),
    name: String(rest.name ?? ""),
    sku: (rest.sku as string | null) ?? null,
    image_url: (rest.image_url as string | null) ?? null,
    unit_cogs: n(rest.unit_cogs),
    packing_cost: n(rest.packing_cost),
    confirmation_processing_cost: n(rest.confirmation_processing_cost),
    default_price: rest.default_price === null || rest.default_price === undefined
      ? null
      : Number(rest.default_price),
    initial_stock: n(rest.initial_stock),
    current_stock: n(rest.current_stock),
    system_inventory: n(rest.system_inventory),
    real_inventory: n(rest.real_inventory),
    low_stock_threshold: n(rest.low_stock_threshold),
    damaged_return_count: n(rest.damaged_return_count),
    // Explicit coercion, not a truthiness check: this is the field whose
    // absence made every toggle send `is_active: true` forever.
    is_active: rest.is_active === true,
    variant_count: product_variants?.[0]?.count ?? 0,
    metrics,
  };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Whole-endpoint gate. warehouse_agent and agent keep using /api/products,
  // which never serves cost columns to them.
  if (!canViewProductProfitability(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 400 rather than "all markets": per-product ad-spend has no defined
  // cross-market allocation, so returning something would be inventing a number.
  let marketId: string;
  if (actor.role === "super_admin") {
    const param = req.nextUrl.searchParams.get("market_id");
    if (!param) {
      return NextResponse.json(
        { error: "market_id query parameter required for super_admin" },
        { status: 400 },
      );
    }
    marketId = param;
  } else {
    // A manager's market_id param is ignored, not trusted.
    if (!actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    marketId = actor.market_id;
  }

  const query = parseProductListQuery(req.nextUrl.searchParams);

  // Currency from the DB, never `code === "ly" ? "LYD" : "TND"`. The old ternary
  // read a markets list that was only fetched for super_admin, so a Libyan
  // manager saw "TND".
  const { data: market } = await supabase
    .from("markets")
    .select("currency")
    .eq("id", marketId)
    .single();
  const currency = (market as { currency?: string } | null)?.currency ?? "TND";

  let catalogue = supabase
    .from("product_inventory_view")
    .select(`${VIEW_COLUMNS}, product_variants(count)`)
    .eq("market_id", marketId)
    .order("name", { ascending: true });

  if (query.q) {
    const escaped = query.q.replace(/[%_]/g, (m) => `\\${m}`);
    catalogue = catalogue.ilike("name", `%${escaped}%`);
  }

  // fetchAllRows, never a bare .select(): PostgREST caps results at 1000 rows,
  // and a truncated catalogue would silently produce wrong facet counts.
  let rawRows: RawViewRow[];
  try {
    rawRows = await fetchAllRows<RawViewRow>(catalogue);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const costInputs = rawRows.map((r) => ({
    id: String(r.id),
    unit_cogs: Number(r.unit_cogs ?? 0),
    packing_cost: Number(r.packing_cost ?? 0),
    confirmation_processing_cost: Number(r.confirmation_processing_cost ?? 0),
  }));

  // One cast, documented in metrics.ts: the generated client type infers the
  // embedded `orders` relation as an array where these queries read it as a
  // single record.
  const metricsClient = supabase as unknown as MetricsClient;

  // ONLY the current window. The previous window used to be loaded here in
  // parallel, which sounds free but is not: on the Libya market it transports
  // ~4,666 rows against the current window's ~611, and two of its fetches cross
  // fetchAllRows' 1000-row page boundary and so serialise into extra round
  // trips. All of that to render two delta percentages on figures that are
  // already on screen. It now lives behind /api/products/list/previous, whose
  // cache key depends only on (market, period) — so changing a filter, a sort or
  // a page does not refetch it at all.
  const currentMetrics = await loadProductPeriodMetrics({
    supabase: metricsClient,
    fromDate: query.from_date,
    toDate: query.to_date,
    products: costInputs,
  });

  const enriched = rawRows.map((r) => toListRow(r, currentMetrics.get(String(r.id)) ?? null));

  // ── the ordering below is the contract; do not reorder ──
  const facets = computeFacetCounts(enriched);
  const matched = applyFacet(enriched, query.filter);
  const sorted = sortRows(matched, query.sort, query.dir);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  // Clamp server-side and report the clamped value; the client syncs its URL
  // FROM the response. Otherwise switching to a narrower filter while on page 3
  // renders an empty table captioned "showing 51–75 of 2".
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.limit;
  const data = sorted.slice(offset, offset + query.limit);

  const split = computeStockSplit(enriched);

  // Totals are market-wide and deliberately independent of `filter`: a KPI that
  // moved when you clicked a filter tile would not be safe to trust.
  let stockValue = 0;
  let stockUnits = 0;
  let revenue = 0;
  let netProfit = 0;
  for (const row of enriched) {
    stockValue += row.current_stock * row.unit_cogs;
    stockUnits += row.current_stock;
    if (row.metrics) {
      revenue += row.metrics.revenue;
      netProfit += row.metrics.net_profit;
    }
  }

  const body: ProductListResponse = {
    data,
    pagination: {
      total,
      page,
      limit: query.limit,
      totalPages,
      rangeFrom: total === 0 ? 0 : offset + 1,
      rangeTo: total === 0 ? 0 : Math.min(offset + data.length, total),
    },
    facets,
    highlights: computeHighlights(enriched),
    totals: {
      stock_value: Math.round(stockValue * 1000) / 1000,
      stock_units: stockUnits,
      revenue: Math.round(revenue * 1000) / 1000,
      net_profit: Math.round(netProfit * 1000) / 1000,
      margin_pct: revenue === 0 ? 0 : Math.round((netProfit / revenue) * 1000) / 10,
      // Filled in by /api/products/list/previous, off the critical path.
      previous_revenue: null,
      previous_net_profit: null,
      ...split,
    },
    period: { from_date: query.from_date, to_date: query.to_date },
    currency,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
  });
}
