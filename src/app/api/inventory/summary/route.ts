import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  computeProductIntelligence,
  reorderSuggestions,
  bucketMovementsByDay,
  damagedRate,
  type ProductIntelligence,
  type HealthClass,
  MOVEMENT_WINDOW_DAYS,
} from "@/lib/calculations/inventory-intelligence";

export const dynamic = "force-dynamic";

const MOVEMENTS_LIMIT = 30;
const PRODUCTS_LIMIT = 200;
const REORDER_HORIZON_DAYS = 14;
const MOVEMENTS_BY_DAY_WINDOW = 14;

interface InventoryProductRow extends ProductIntelligence {
  stock_value: number;
  is_low: boolean;
  is_out: boolean;
}

interface InventoryMovementRow {
  id: string;
  product_id: string;
  product_name: string;
  order_id: string | null;
  change: number;
  balance_after: number;
  reason: string;
  note: string | null;
  is_damaged: boolean;
  created_at: string;
}

interface MovementDayRow {
  day: string;
  net_change: number;
  movement_count: number;
}

interface ReorderItem {
  id: string;
  name: string;
  current_stock: number;
  avg_daily_sales: number;
  days_of_supply: number;
  unit_cost: number;
}

export interface InventorySummary {
  totals: {
    products_tracked: number;
    low_stock_count: number;
    out_of_stock_count: number;
    damaged_count: number;
    stock_value: number;
    healthy_count: number;
    overstocked_count: number;
    reorder_count: number;
    scan_out_qty_30d: number;
  };
  products: InventoryProductRow[];
  reorder_suggestions: ReorderItem[];
  movements_by_day: MovementDayRow[];
  recent_movements: InventoryMovementRow[];
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "super_admin" && role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorMarketId = actor.market_id ?? "";
  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  const windowStartIso = new Date(
    Date.now() - MOVEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  /* ─────────────── Products ─────────────── */
  let productsQuery = supabase
    .from("products")
    .select("id, name, current_stock, low_stock_threshold, unit_cogs, damaged_return_count")
    .eq("is_active", true)
    .order("current_stock", { ascending: true })
    .limit(PRODUCTS_LIMIT);
  if (marketId) productsQuery = productsQuery.eq("market_id", marketId);

  /* ─────────────── inventory_log (last 30 days, market-filtered) ─────────────── */
  let logQuery = supabase
    .from("inventory_log")
    .select(
      "id, product_id, order_id, change, balance_after, reason, note, is_damaged, created_at, products!inner(name, market_id)",
    )
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false });
  if (marketId) logQuery = logQuery.eq("products.market_id", marketId);

  const [productsResult, logResult] = await Promise.all([productsQuery, logQuery]);

  if (productsResult.error || logResult.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rawProducts = (productsResult.data ?? []) as Array<{
    id: string;
    name: string;
    current_stock: number;
    low_stock_threshold: number;
    unit_cogs: number;
    damaged_return_count: number;
  }>;

  const rawLog = (logResult.data ?? []) as Array<{
    id: string;
    product_id: string;
    order_id: string | null;
    change: number;
    balance_after: number;
    reason: string;
    is_damaged: boolean;
    note: string | null;
    created_at: string;
    products: { name: string } | { name: string }[] | null;
  }>;

  // Single pass: per-product aggregates + bucket rows + recent movements slice
  const scanOutQtyByProduct = new Map<string, number>();
  const returnsQtyByProduct = new Map<string, number>();
  const bucketWindowStart = new Date(
    Date.now() - MOVEMENTS_BY_DAY_WINDOW * 24 * 60 * 60 * 1000,
  );
  const bucketRows: { created_at: string; change: number }[] = [];
  const recent_movements: InventoryMovementRow[] = [];
  for (const row of rawLog) {
    if (row.reason === "deposit" && row.change < 0) {
      scanOutQtyByProduct.set(
        row.product_id,
        (scanOutQtyByProduct.get(row.product_id) ?? 0) + Math.abs(row.change),
      );
    }
    if (row.reason === "returned" || (row.reason === "damaged_return" && row.is_damaged)) {
      returnsQtyByProduct.set(
        row.product_id,
        (returnsQtyByProduct.get(row.product_id) ?? 0) + 1,
      );
    }
    if (new Date(row.created_at) >= bucketWindowStart) {
      bucketRows.push({ created_at: row.created_at, change: row.change });
    }
    if (recent_movements.length < MOVEMENTS_LIMIT) {
      const productRel = Array.isArray(row.products) ? row.products[0] : row.products;
      recent_movements.push({
        id: row.id,
        product_id: row.product_id,
        product_name: productRel?.name ?? "",
        order_id: row.order_id,
        change: row.change,
        balance_after: row.balance_after,
        reason: row.reason,
        note: row.note,
        is_damaged: row.is_damaged,
        created_at: row.created_at,
      });
    }
  }

  // Compute mean damaged rate across products with any returns — needed for outlier detection
  const perProductDamagedRates: number[] = [];
  for (const p of rawProducts) {
    const returns = returnsQtyByProduct.get(p.id) ?? 0;
    if (returns > 0) {
      perProductDamagedRates.push(damagedRate(p.damaged_return_count, returns));
    }
  }
  const meanDamagedRate =
    perProductDamagedRates.length > 0
      ? perProductDamagedRates.reduce((s, n) => s + n, 0) / perProductDamagedRates.length
      : 0;

  // Build enriched products
  const products: InventoryProductRow[] = rawProducts.map((p) => {
    const unitCost = Number(p.unit_cogs) || 0;
    const scanOutQty = scanOutQtyByProduct.get(p.id) ?? 0;
    const returnsQty = returnsQtyByProduct.get(p.id) ?? 0;
    const intel = computeProductIntelligence({
      id: p.id,
      name: p.name,
      current_stock: p.current_stock,
      low_stock_threshold: p.low_stock_threshold,
      unit_cost: unitCost,
      damaged_return_count: p.damaged_return_count,
      scan_out_qty_30d: scanOutQty,
      returns_qty_30d: returnsQty,
      meanDamagedRate,
    });
    return {
      ...intel,
      is_low: intel.health === "low",
      is_out: intel.health === "out",
    };
  });

  // Totals
  const totals = products.reduce(
    (acc, p) => {
      acc.products_tracked += 1;
      if (p.health === "low") acc.low_stock_count += 1;
      if (p.health === "out") acc.out_of_stock_count += 1;
      if (p.health === "healthy") acc.healthy_count += 1;
      if (p.health === "overstocked") acc.overstocked_count += 1;
      acc.damaged_count += p.damaged_return_count;
      acc.stock_value += p.stock_value;
      acc.scan_out_qty_30d += scanOutQtyByProduct.get(p.id) ?? 0;
      return acc;
    },
    {
      products_tracked: 0,
      low_stock_count: 0,
      out_of_stock_count: 0,
      damaged_count: 0,
      stock_value: 0,
      healthy_count: 0,
      overstocked_count: 0,
      reorder_count: 0,
      scan_out_qty_30d: 0,
    },
  );

  const reorderInputs = products.map((p) => ({
    id: p.id,
    name: p.name,
    currentStock: p.current_stock,
    avgDailySales: p.avg_daily_sales,
    daysOfSupplyVal: p.days_of_supply,
    unit_cost: p.unit_cost,
  }));
  const reorderList = reorderSuggestions(reorderInputs, { horizonDays: REORDER_HORIZON_DAYS });
  totals.reorder_count = reorderList.length;

  const reorder_suggestions: ReorderItem[] = reorderList.map((r) => ({
    id: r.id,
    name: r.name,
    current_stock: r.currentStock,
    avg_daily_sales: r.avgDailySales,
    days_of_supply: r.daysOfSupplyVal ?? 0,
    unit_cost: r.unit_cost ?? 0,
  }));

  const movements_by_day = bucketMovementsByDay(bucketRows);

  const body: InventorySummary = {
    totals,
    products,
    reorder_suggestions,
    movements_by_day,
    recent_movements,
  };

  return NextResponse.json(body);
}

export type { HealthClass };
