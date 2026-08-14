// GET /api/products/list/previous — two scalars for the KPI delta pills.
//
// ── WHY THIS IS ITS OWN ENDPOINT ──────────────────────────────────────────
// It used to be a second loadProductPeriodMetrics() call inside
// /api/products/list, running concurrently with the current window. Concurrent
// is not free. Measured on the Libya market:
//
//   current  30d →   227 leads +  258 confirmed + 115 dispatched + 7 + 4  ≈  611 rows
//   previous 30d → 1 633 leads + 1838 confirmed + 825 dispatched + 288 + 82 ≈ 4 666 rows
//
// 7.6x the transport, and both `leads` (1 633) and `confirmed` (1 838) cross
// fetchAllRows' 1000-row page boundary, so each becomes two SEQUENTIAL round
// trips. The blocking request therefore waited on the heavier of the two
// windows — to render two percentages next to figures already on screen.
//
// Splitting it out buys three things:
//   1. The table, KPI figures and facet counts paint without it.
//   2. Its cache key depends only on (market, period) — not filter, sort or
//      page — so browsing the list never refetches it.
//   3. It is historical data that cannot change, so it caches far harder than
//      the live list (5 min fresh / 30 min stale, vs 30 s / 5 min).
//
// The formula is NOT duplicated: this calls the same loadProductPeriodMetrics
// and sums its output, so the deltas cannot drift from the figures they annotate.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewProductProfitability } from "@/lib/finance-permissions";
import { computePreviousPeriod } from "@/lib/date";
import { loadProductPeriodMetrics, type MetricsClient } from "@/lib/products/metrics";
import { parseProductListQuery } from "@/lib/products/list-filters";

export const dynamic = "force-dynamic";

export interface ProductPreviousTotals {
  revenue: number;
  net_profit: number;
  period: { from_date: string; to_date: string };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewProductProfitability(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    if (!actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    marketId = actor.market_id;
  }

  // Reuses the shared parser purely for its date defaulting and ISO validation;
  // filter/sort/page are irrelevant here and ignored.
  const { from_date, to_date } = parseProductListQuery(req.nextUrl.searchParams);
  const prev = computePreviousPeriod(from_date, to_date);

  // Cost inputs straight off the base table — four columns, one row per product.
  // The view is not needed: no stock or catalogue field is used here.
  const { data: products, error } = await supabase
    .from("products")
    .select("id, unit_cogs, packing_cost, confirmation_processing_cost")
    .eq("market_id", marketId)
    // Même catalogue que la période courante, sinon la comparaison porte sur
    // deux ensembles de produits différents et la variation est fausse.
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = (products ?? []) as {
    id: string;
    unit_cogs: number | null;
    packing_cost: number | null;
    confirmation_processing_cost: number | null;
  }[];

  const metrics = await loadProductPeriodMetrics({
    supabase: supabase as unknown as MetricsClient,
    fromDate: prev.from_date,
    toDate: prev.to_date,
    products: rows.map((p) => ({
      id: p.id,
      unit_cogs: Number(p.unit_cogs ?? 0),
      packing_cost: Number(p.packing_cost ?? 0),
      confirmation_processing_cost: Number(p.confirmation_processing_cost ?? 0),
    })),
  });

  let revenue = 0;
  let netProfit = 0;
  for (const m of metrics.values()) {
    revenue += m.revenue;
    netProfit += m.net_profit;
  }

  const body: ProductPreviousTotals = {
    revenue: Math.round(revenue * 1000) / 1000,
    net_profit: Math.round(netProfit * 1000) / 1000,
    period: prev,
  };

  return NextResponse.json(body, {
    // A closed historical window cannot change. Cache it far harder than the
    // live list, so revisiting /products or changing a filter costs nothing.
    headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=1800" },
  });
}
