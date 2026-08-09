// Per-product, period-scoped profitability for the /products list.
//
// ── PROVENANCE ────────────────────────────────────────────────────────────
// This is the body of GET /api/products/profitability-bulk, lifted verbatim and
// given a `toWireMetrics()` boundary. That route is deleted in the same change:
// two endpoints computing the same numbers through the same code is how one of
// them gets updated and the other silently doesn't.
//
// ── WHY THIS STAYS TYPESCRIPT ─────────────────────────────────────────────
// Doing the aggregation in SQL would be faster, and is the documented escape
// hatch once a single market passes ~2000 products or the 30-day window exceeds
// ~1.5s p95. It is NOT done yet because `calculateProductProfitability` is the
// canonical money formula with specific rounding, Vitest cannot execute
// Postgres, and reimplementing it in PL/pgSQL would strip its unit tests — which
// collides head-on with the TDD rule. `get_profitability_summary` already had to
// *claim* byte-identical output in a comment because nothing could assert it.
//
// The cost axis here is ORDER volume, not catalogue size, and the page already
// pays exactly that cost today.

import { calculateProductProfitability } from "@/lib/calculations/product-profitability";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { ProductPeriodMetrics } from "@/types/product-list";

/** An order counts as confirmed once, whether seen as `confirmed` or `uploaded`. */
const CONFIRMED_STATUSES = ["confirmed", "uploaded"] as const;

/** Cost inputs the caller has already read off the product row. */
export interface MetricsProductInput {
  id: string;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost: number | null;
}

/**
 * Structurally typed rather than SupabaseClient.
 *
 * The generated client type disagrees with the hand-written embedded shapes
 * below — PostgREST infers `orders` as an array where these queries treat it as
 * a single record — and `fetchAllRows` already documents the same compromise.
 * Resolving on `.range` is what makes this compatible with fetchAllRows.
 */
export interface MetricsQueryBuilder {
  select: (columns: string) => MetricsQueryBuilder;
  in: (column: string, values: readonly unknown[]) => MetricsQueryBuilder;
  eq: (column: string, value: unknown) => MetricsQueryBuilder;
  gte: (column: string, value: unknown) => MetricsQueryBuilder;
  lte: (column: string, value: unknown) => MetricsQueryBuilder;
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface MetricsClient {
  from: (table: string) => MetricsQueryBuilder;
}

interface LoadArgs {
  supabase: MetricsClient;
  fromDate: string;
  toDate: string;
  products: MetricsProductInput[];
}

type OrderRow = { product_id: string };
type ConfirmedRow = { order_id: string; orders: OrderRow };
type DispatchedRow = { orders: OrderRow };
type DeliveredRow = {
  orders: {
    product_id: string;
    total_price: number;
    quantity: number;
    carriers: { delivery_fee: number } | null;
  };
};
type ReturnedRow = {
  orders: { product_id: string; carriers: { return_fee: number } | null };
};
type AdSpendRow = { product_id: string | null; amount: number | string };

/**
 * Maps the calc result onto the wire shape. The ONLY place
 * `simplifiedNetProfit` becomes `net_profit`, so product-profitability.ts and
 * its tests never have to change for a rename.
 */
function toWireMetrics(
  result: ReturnType<typeof calculateProductProfitability>,
  counts: { confirmed: number; dispatched: number; delivered: number; returned: number },
): ProductPeriodMetrics {
  return {
    total_leads: result.totalLeads,
    confirmed_count: counts.confirmed,
    dispatched_count: counts.dispatched,
    delivered_count: counts.delivered,
    returned_count: counts.returned,
    confirmation_rate: result.confirmationRate,
    delivery_rate: result.deliveryRate,
    return_rate: result.returnRate,
    revenue: result.revenue,
    net_profit: result.simplifiedNetProfit,
    // Canonical rule, preserved exactly: revenue 0 → margin 0, never a division
    // by zero and never -Infinity. The consequence is that a zero-revenue
    // product with real costs surfaces under `noSales`, not `losingMoney`.
    margin_pct:
      result.revenue === 0
        ? 0
        : Math.round((result.simplifiedNetProfit / result.revenue) * 1000) / 10,
    cost_per_delivered: result.costPerDelivered,
    // Passed straight through, unrounded, so the composition chart's bars sum
    // back to net_profit exactly rather than drifting by a rounding residue.
    cogs: result.totalCogs,
    delivery_cost: result.totalDeliveryCost,
    return_cost: result.totalReturnCost,
    packing_cost: result.totalPackingCost,
    processing_cost: result.totalProcessingCost,
    ad_spend: result.totalAdSpend,
  };
}

/**
 * Returns an entry for EVERY product passed in — zero-filled when the product
 * had no activity in the window.
 *
 * That is load-bearing. An absent entry would be indistinguishable from
 * "metrics not permitted", and the `noSales` facet is defined as
 * `total_leads === 0`, which cannot be evaluated on a missing row.
 */
export async function loadProductPeriodMetrics({
  supabase,
  fromDate,
  toDate,
  products,
}: LoadArgs): Promise<Map<string, ProductPeriodMetrics>> {
  const out = new Map<string, ProductPeriodMetrics>();
  if (products.length === 0) return out;

  const productIds = products.map((p) => p.id);
  const toDateEnd = `${toDate}T23:59:59.999Z`;

  // Counts come from order_history, never orders.status: status is the CURRENT
  // state, so a delivered order would otherwise vanish from the confirmed count
  // for the period in which it was actually confirmed.
  const [leadsRows, confirmedRows, dispatchedRows, deliveredRows, returnedRows, adSpendRows] =
    await Promise.all([
      fetchAllRows<OrderRow>(
        supabase
          .from("orders")
          .select("product_id")
          .in("product_id", productIds)
          .gte("created_at", fromDate)
          .lte("created_at", toDateEnd),
      ),
      fetchAllRows<ConfirmedRow>(
        supabase
          .from("order_history")
          .select("order_id, orders!inner(product_id)")
          .in("status_to", CONFIRMED_STATUSES)
          .in("orders.product_id", productIds)
          .gte("created_at", fromDate)
          .lte("created_at", toDateEnd),
      ),
      fetchAllRows<DispatchedRow>(
        supabase
          .from("order_history")
          .select("orders!inner(product_id)")
          .eq("status_to", "uploaded")
          .in("orders.product_id", productIds)
          .gte("created_at", fromDate)
          .lte("created_at", toDateEnd),
      ),
      fetchAllRows<DeliveredRow>(
        supabase
          .from("order_history")
          .select(
            "orders!inner(product_id, total_price, quantity, carriers!orders_carrier_id_fkey(delivery_fee))",
          )
          .eq("status_to", "delivered")
          .in("orders.product_id", productIds)
          .gte("created_at", fromDate)
          .lte("created_at", toDateEnd),
      ),
      fetchAllRows<ReturnedRow>(
        supabase
          .from("order_history")
          .select("orders!inner(product_id, carriers!orders_carrier_id_fkey(return_fee))")
          .eq("status_to", "returned")
          .in("orders.product_id", productIds)
          .gte("created_at", fromDate)
          .lte("created_at", toDateEnd),
      ),
      fetchAllRows<AdSpendRow>(
        supabase
          .from("ad_spend")
          .select("product_id, amount")
          .in("product_id", productIds)
          .eq("is_active", true)
          .lte("period_start", toDate)
          .gte("period_end", fromDate),
      ),
    ]);

  const leadCount = new Map<string, number>();
  for (const row of leadsRows) {
    if (!row.product_id) continue;
    leadCount.set(row.product_id, (leadCount.get(row.product_id) ?? 0) + 1);
  }

  // A Set, not a counter: one order seen as both `confirmed` and `uploaded` is
  // ONE confirmation. Packing and processing cost are charged per order.
  const confirmedOrderIds = new Map<string, Set<string>>();
  for (const row of confirmedRows) {
    const pid = row.orders?.product_id;
    if (!pid || !row.order_id) continue;
    const ids = confirmedOrderIds.get(pid) ?? new Set<string>();
    ids.add(row.order_id);
    confirmedOrderIds.set(pid, ids);
  }

  const dispatchedCount = new Map<string, number>();
  for (const row of dispatchedRows) {
    const pid = row.orders?.product_id;
    if (pid) dispatchedCount.set(pid, (dispatchedCount.get(pid) ?? 0) + 1);
  }

  const deliveredByProduct = new Map<
    string,
    { total_price: number; quantity: number; carrier_delivery_fee: number }[]
  >();
  for (const row of deliveredRows) {
    const o = row.orders;
    if (!o?.product_id) continue;
    const arr = deliveredByProduct.get(o.product_id) ?? [];
    arr.push({
      total_price: Number(o.total_price),
      quantity: Number(o.quantity),
      carrier_delivery_fee: Number(o.carriers?.delivery_fee ?? 0),
    });
    deliveredByProduct.set(o.product_id, arr);
  }

  const returnedByProduct = new Map<string, { carrier_return_fee: number }[]>();
  for (const row of returnedRows) {
    const o = row.orders;
    if (!o?.product_id) continue;
    const arr = returnedByProduct.get(o.product_id) ?? [];
    arr.push({ carrier_return_fee: Number(o.carriers?.return_fee ?? 0) });
    returnedByProduct.set(o.product_id, arr);
  }

  // A NULL product_id on ad_spend means market-wide, which has no defined
  // per-product allocation — skip rather than invent one.
  const adSpendByProduct = new Map<string, number>();
  for (const row of adSpendRows) {
    if (!row.product_id) continue;
    adSpendByProduct.set(
      row.product_id,
      (adSpendByProduct.get(row.product_id) ?? 0) + Number(row.amount),
    );
  }

  for (const p of products) {
    const delivered = deliveredByProduct.get(p.id) ?? [];
    const returned = returnedByProduct.get(p.id) ?? [];
    const counts = {
      confirmed: confirmedOrderIds.get(p.id)?.size ?? 0,
      dispatched: dispatchedCount.get(p.id) ?? 0,
      delivered: delivered.length,
      returned: returned.length,
    };

    const result = calculateProductProfitability({
      totalLeads: leadCount.get(p.id) ?? 0,
      confirmedCount: counts.confirmed,
      dispatchedCount: counts.dispatched,
      deliveredCount: counts.delivered,
      returnedCount: counts.returned,
      unitCogs: Number(p.unit_cogs),
      packingCost: Number(p.packing_cost),
      adSpend: adSpendByProduct.get(p.id) ?? 0,
      confirmationProcessingCost: Number(p.confirmation_processing_cost ?? 0),
      deliveredOrders: delivered,
      returnedOrders: returned,
    });

    out.set(p.id, toWireMetrics(result, counts));
  }

  return out;
}
