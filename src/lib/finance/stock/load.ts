/**
 * Loader for Finances › Stock & inventaire. The market position comes from the
 * same RPC as before (getStockPosition); this adds what the page needs per
 * warehouse — units from product_site_stock, what each site shipped in the
 * window (to split the sales rate), and open purchase orders per site.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStockPosition } from "@/lib/inventory/stock-position";
import type { DemandWindowDays } from "@/lib/inventory/stock-position-types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { lastNDaysPeriod } from "@/lib/date";
import { todayInMarket } from "@/lib/dates/market-day";
import type { Role } from "@/types";
import { buildStockView, type StockInput, type StockView } from "./model";

/** Every status an order reaches after it left the shelf, Darb's included. */
const LEFT_SHELF = [
  "uploaded", "scanned", "dispatched", "deposit", "in_transit", "unverified", "at_carrier",
  "out_for_delivery", "delivery_delayed", "returning", "to_be_returned", "received", "delivered", "returned",
];

export interface StockPageData extends StockView {
  today: string;
  windowDays: number;
  leadTimeDays: number;
  /** days per point of each product's `series` (1, or 7 on the 90-day window) */
  seriesBucketDays: number;
}

export async function loadStockPage(
  supabase: SupabaseClient,
  input: { marketId: string; windowDays: DemandWindowDays; role: Role; actorMarketId: string | null },
): Promise<StockPageData> {
  const today = todayInMarket(input.marketId);
  const period = lastNDaysPeriod(input.windowDays);

  const [position, sitesRes, siteStock, shipped, prices, openPos] = await Promise.all([
    getStockPosition({ windowDays: input.windowDays, marketId: input.marketId, role: input.role, actorMarketId: input.actorMarketId }),
    supabase
      .from("warehouses")
      .select("id, name_fr, is_default, code")
      .eq("market_id", input.marketId)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("code", { ascending: true }),
    fetchAllRows<{ product_id: string; warehouse_id: string; current_stock: number }>(
      supabase.from("product_site_stock").select("product_id, warehouse_id, current_stock, variant_id").order("product_id").order("warehouse_id").order("variant_id"),
    ),
    fetchAllRows<{ product_id: string | null; quantity: number | null; warehouse_id: string | null }>(
      supabase
        .from("orders")
        .select("id, product_id, quantity, warehouse_id")
        .eq("market_id", input.marketId)
        .gte("created_at", period.from_date)
        .in("status", LEFT_SHELF)
        .not("warehouse_id", "is", null)
        .order("id"),
    ),
    supabase.from("products").select("id, default_price").eq("market_id", input.marketId),
    supabase
      .from("purchase_orders")
      .select("id, reference, warehouse_id, wanted_by")
      .eq("market_id", input.marketId)
      .eq("status", "open"),
  ]);
  if (sitesRes.error) throw new Error(sitesRes.error.message);

  const poById = new Map((openPos.data ?? []).map((p) => [p.id as string, p]));
  let onOrder: StockInput["onOrder"] = [];
  if (poById.size) {
    const { data: lines } = await supabase
      .from("purchase_order_line_progress")
      .select("purchase_order_id, product_id, ordered_qty, received_qty")
      .in("purchase_order_id", [...poById.keys()]);
    onOrder = (lines ?? [])
      .map((l) => {
        const po = poById.get(l.purchase_order_id as string)!;
        return {
          product: l.product_id as string,
          site: po.warehouse_id as string,
          qty: Math.max(0, Number(l.ordered_qty ?? 0) - Number(l.received_qty ?? 0)),
          eta: (po.wanted_by as string | null) ?? null,
          ref: po.reference as string,
        };
      })
      .filter((o) => o.qty > 0);
  }

  const price = new Map((prices.data ?? []).map((p) => [p.id as string, Number(p.default_price ?? 0)]));
  const siteIds = new Set((sitesRes.data ?? []).map((s) => s.id as string));
  const products = position.products.filter((p) => p.source === "own" && (p.physical_stock > 0 || p.demand_rate_per_day > 0));

  const view = buildStockView({
    today,
    windowDays: input.windowDays,
    leadTimeDays: products[0]?.lead_time_days ?? 14,
    sites: (sitesRes.data ?? []).map((s) => ({ id: s.id as string, name: s.name_fr as string })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      image: p.image_url,
      cost: p.unit_cogs,
      price: price.get(p.id) ?? 0,
      units: Math.max(0, p.physical_stock),
      rate: p.demand_rate_per_day,
      daysSinceSale: p.days_since_last_sale,
      lastCounted: p.last_counted_at,
      series: p.demand_series.map((d) => d.units),
    })),
    siteUnits: siteStock.filter((r) => siteIds.has(r.warehouse_id)).map((r) => ({ product: r.product_id, site: r.warehouse_id, units: Number(r.current_stock) })),
    siteShipped: shipped
      .filter((o) => o.product_id && o.warehouse_id && siteIds.has(o.warehouse_id))
      .map((o) => ({ product: o.product_id!, site: o.warehouse_id!, units: Number(o.quantity ?? 1) })),
    onOrder: onOrder.filter((o) => siteIds.has(o.site)),
  });

  return {
    ...view,
    today,
    windowDays: input.windowDays,
    leadTimeDays: products[0]?.lead_time_days ?? 14,
    seriesBucketDays: products[0]?.demand_bucket_days ?? 1,
  };
}
