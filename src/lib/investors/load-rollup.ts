import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import {
  buildDailyStats,
  type DailyProductStat,
  type RollupOrder,
  type ProductCosts,
  type CarrierFees,
} from "./rollup";

/**
 * Loads one day of activity and folds it into per-product rows.
 *
 * Runs under the service-role client from the cron route: this reads across
 * every product in a market, which no user role is entitled to do, and the
 * portal only ever sees the slice belonging to a position the investor holds.
 *
 * Period attribution matches docs/business-logic.md exactly — a metric belongs
 * to the day its order_history transition happened, not the day the order was
 * created. Leads are the one exception: they are counted by orders.created_at,
 * because a lead IS the intake event.
 */

type Supa = SupabaseClient;

interface HistoryRow {
  order_id: string;
  orders: { id: string; total_price: number; carrier_id: string | null };
}

interface ItemRow {
  order_id: string;
  product_id: string | null;
  quantity: number;
  line_total: number;
}

const TRACKED_STATUSES = ["confirmed", "uploaded", "delivered", "returned"] as const;
type TrackedStatus = (typeof TRACKED_STATUSES)[number];

/** Inclusive day count between two ISO dates. */
export function daysInPeriod(start: string, end: string): number {
  const ms = Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z");
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

/**
 * Spreads each product-scoped ad_spend row evenly across the days it covers,
 * so summing any date range reproduces the original spend.
 */
export function prorateAdSpend(
  rows: { product_id: string | null; amount: number; period_start: string; period_end: string }[],
  statDate: string
): Map<string, number> {
  const daily = new Map<string, number>();

  for (const row of rows) {
    if (!row.product_id) continue; // market-wide spend is allocated at settlement
    if (statDate < row.period_start || statDate > row.period_end) continue;

    const share = Math.round(
      toMillimes(Number(row.amount)) / daysInPeriod(row.period_start, row.period_end)
    );
    daily.set(row.product_id, (daily.get(row.product_id) ?? 0) + share);
  }

  return new Map([...daily].map(([k, v]) => [k, fromMillimes(v)]));
}

export async function computeDailyRollup(
  admin: Supa,
  statDate: string,
  marketId: string
): Promise<DailyProductStat[]> {
  const dayStart = `${statDate}T00:00:00.000Z`;
  const dayEnd = `${statDate}T23:59:59.999Z`;

  // order_history.market_id is denormalized (20260818000001), so this filters
  // on the base table instead of forcing a per-row EXISTS against orders.
  const historyByStatus = await Promise.all(
    TRACKED_STATUSES.map((status) =>
      fetchAllRows<HistoryRow>(
        admin
          .from("order_history")
          .select("order_id, orders!inner(id, total_price, carrier_id)")
          .eq("status_to", status)
          .eq("market_id", marketId)
          .gte("created_at", dayStart)
          .lte("created_at", dayEnd)
      )
    )
  );

  const leadRows = await fetchAllRows<{ id: string; total_price: number; carrier_id: string | null }>(
    admin
      .from("orders")
      .select("id, total_price, carrier_id")
      .eq("market_id", marketId)
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
  );

  const byStatus = new Map<TrackedStatus, HistoryRow[]>(
    TRACKED_STATUSES.map((s, i) => [s, historyByStatus[i]])
  );

  // Every order we need line items for, across all buckets.
  const orderIds = new Set<string>();
  for (const rows of historyByStatus) for (const r of rows) orderIds.add(r.order_id);
  for (const r of leadRows) orderIds.add(r.id);

  const items =
    orderIds.size > 0
      ? await fetchAllRows<ItemRow>(
          admin
            .from("order_items")
            .select("order_id, product_id, quantity, line_total")
            .in("order_id", [...orderIds])
        )
      : [];

  const linesByOrder = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = linesByOrder.get(item.order_id) ?? [];
    list.push(item);
    linesByOrder.set(item.order_id, list);
  }

  const toRollupOrder = (o: {
    id: string;
    total_price: number;
    carrier_id: string | null;
  }): RollupOrder => ({
    orderId: o.id,
    totalPrice: Number(o.total_price),
    carrierId: o.carrier_id,
    lines: (linesByOrder.get(o.id) ?? []).map((l) => ({
      productId: l.product_id,
      lineTotal: Number(l.line_total),
      quantity: Number(l.quantity),
    })),
  });

  const bucket = (s: TrackedStatus): RollupOrder[] =>
    (byStatus.get(s) ?? []).map((h) => toRollupOrder(h.orders));

  // Costs are read as they are TODAY. That is correct for the rollup, which is
  // a live operational view and is recomputed whenever a day is replayed.
  // Settlement does NOT rely on this — it snapshots its cost inputs precisely
  // so a later price edit cannot rewrite a period already paid out.
  const productIds = new Set<string>();
  for (const list of linesByOrder.values())
    for (const l of list) if (l.product_id) productIds.add(l.product_id);

  const [{ data: productRows }, { data: carrierRows }, adSpendResult] = await Promise.all([
    productIds.size > 0
      ? admin
          .from("products")
          .select("id, unit_cogs, packing_cost, confirmation_processing_cost")
          .in("id", [...productIds])
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    admin.from("carriers").select("id, delivery_fee, return_fee"),
    admin
      .from("ad_spend")
      .select("product_id, amount, period_start, period_end")
      .eq("market_id", marketId)
      .eq("is_active", true)
      .not("product_id", "is", null)
      .lte("period_start", statDate)
      .gte("period_end", statDate),
  ]);

  const products = new Map<string, ProductCosts>(
    ((productRows ?? []) as Record<string, unknown>[]).map((p) => [
      p.id as string,
      {
        unitCogs: Number(p.unit_cogs ?? 0),
        packingCost: Number(p.packing_cost ?? 0),
        processingCost: Number(p.confirmation_processing_cost ?? 0),
      },
    ])
  );

  const carriers = new Map<string, CarrierFees>(
    ((carrierRows ?? []) as Record<string, unknown>[]).map((c) => [
      c.id as string,
      {
        deliveryFee: Number(c.delivery_fee ?? 0),
        returnFee: Number(c.return_fee ?? 0),
      },
    ])
  );

  return buildDailyStats({
    statDate,
    marketId,
    leadOrders: leadRows.map(toRollupOrder),
    confirmedOrders: bucket("confirmed"),
    uploadedOrders: bucket("uploaded"),
    deliveredOrders: bucket("delivered"),
    returnedOrders: bucket("returned"),
    products,
    carriers,
    adSpendDaily: prorateAdSpend(
      (adSpendResult.data ?? []) as {
        product_id: string | null;
        amount: number;
        period_start: string;
        period_end: string;
      }[],
      statDate
    ),
  });
}

/**
 * Upserts a day's rows. The (stat_date, market_id, product_id) unique
 * constraint makes replaying a day idempotent, which matters because days get
 * recomputed whenever a late carrier event lands.
 */
export async function persistDailyRollup(
  admin: Supa,
  rows: DailyProductStat[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await admin
    .from("investor_daily_product_stats")
    .upsert(
      rows.map((r) => ({ ...r, computed_at: new Date().toISOString() })),
      { onConflict: "stat_date,market_id,product_id" }
    );

  if (error) throw new Error(`rollup upsert failed: ${error.message}`);
  return rows.length;
}
