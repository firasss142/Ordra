import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

export const dynamic = "force-dynamic";

/**
 * Stock as the floor sees it: units, not money.
 *
 * Deliberately NOT /api/inventory/position — that one is costed at COGS and
 * gated to super_admin, and a warehouse agent has no business seeing what the
 * shelf is worth. Same products, different question.
 */

export interface WarehouseStockRow {
  product_id: string;
  name: string;
  /** What is printed on the shelf label. Null for products nobody has coded. */
  sku: string | null;
  image_url: string | null;
  current_stock: number;
  low_stock_threshold: number;
  /**
   * The target somebody set, or null. Null is a fact, not a zero: rendering an
   * unset target as "Goal: 0" paints every product as wildly overstocked.
   */
  stock_goal: number | null;
  /** current_stock as a percentage of the target, capped. Null without one. */
  goal_pct: number | null;
  damaged_return_count: number;
  /** Units already committed to orders that have left the agent queue. */
  engaged: number;
  /** current_stock - engaged. Negative means we owe more than we hold. */
  free: number;
  last_counted_at: string | null;
  /**
   * How close the books were to the shelf at the last physical count. Null
   * where nobody has counted — "never verified" and "verified and correct"
   * are opposite facts and must not share a number.
   */
  accuracy: number | null;
  /** Daily on-hand level, oldest first — the card's sparkline. */
  series: number[];
}

/** Two weeks is what fits a 56px sparkline without the line becoming noise. */
const SERIES_DAYS = 14;
/** A count older than a quarter is not evidence about today's shelf. */
const ACCURACY_DAYS = 90;

/**
 * Statuses that hold a unit spoken for but still ON THE SHELF. `scanned` is
 * the stock boundary: scan_order_out already deducted those units, so counting
 * them again against current_stock invents a deficit (measured on the Libyan
 * bench: held 7, "engaged" 11, free −4, for a shelf that was fine).
 */
const ENGAGED_STATUSES = ["confirmed", "dispatch_scheduled", "uploaded"];

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id")
      : actor.market_id;

  let productQuery = supabase
    .from("products")
    .select(
      "id, name, sku, image_url, current_stock, low_stock_threshold, stock_goal, damaged_return_count, market_id",
    )
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (marketId) productQuery = productQuery.eq("market_id", marketId);

  const { data: products, error } = await productQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (products ?? []).map((p) => p.id);
  if (ids.length === 0) return NextResponse.json({ rows: [] });

  // Engaged units and the last count are two small reads rather than a view,
  // so this route stays deletable without a migration behind it.
  const [{ data: engagedRows }, { data: counts }, { data: seriesRows }, { data: accuracyData }] =
    await Promise.all([
    supabase
      .from("orders")
      .select("product_id, quantity")
      .in("product_id", ids)
      .in("status", ENGAGED_STATUSES),
    supabase
      .from("inventory_log")
      .select("product_id, created_at")
      .in("product_id", ids)
      .eq("reason", "stock_count")
      .order("created_at", { ascending: false }),
    // The card's sparkline. balance_after is on every inventory_log row and
    // the table is append-only, so the history needs no store of its own.
    supabase.rpc("get_product_stock_series", { p_product_ids: ids, p_days: SERIES_DAYS }),
    supabase.rpc("get_count_accuracy", { p_market_id: marketId ?? null, p_days: ACCURACY_DAYS }),
  ]);

  const engagedBy = new Map<string, number>();
  for (const o of engagedRows ?? []) {
    if (!o.product_id) continue;
    engagedBy.set(o.product_id, (engagedBy.get(o.product_id) ?? 0) + (o.quantity ?? 0));
  }
  const countedBy = new Map<string, string>();
  for (const c of counts ?? []) {
    if (c.product_id && !countedBy.has(c.product_id)) countedBy.set(c.product_id, c.created_at);
  }

  // The RPC returns one row per product per day, already ordered; collecting
  // in arrival order keeps the line chronological without a second sort.
  const seriesBy = new Map<string, number[]>();
  for (const r of (seriesRows ?? []) as Array<{ product_id: string; balance: number }>) {
    const bucket = seriesBy.get(r.product_id);
    if (bucket) bucket.push(r.balance);
    else seriesBy.set(r.product_id, [r.balance]);
  }

  const accuracyBy = new Map<string, number | null>();
  for (const a of ((accuracyData as { products?: Array<{ product_id: string; accuracy: number | null }> } | null)
    ?.products ?? [])) {
    accuracyBy.set(a.product_id, a.accuracy);
  }

  const rows: WarehouseStockRow[] = (products ?? []).map((p) => {
    const engaged = engagedBy.get(p.id) ?? 0;
    const goal = typeof p.stock_goal === "number" ? p.stock_goal : null;
    return {
      product_id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      image_url: p.image_url ?? null,
      current_stock: p.current_stock ?? 0,
      low_stock_threshold: p.low_stock_threshold ?? 0,
      stock_goal: goal,
      goal_pct:
        goal && goal > 0
          ? Math.min(Math.round(((p.current_stock ?? 0) / goal) * 100), 100)
          : null,
      damaged_return_count: p.damaged_return_count ?? 0,
      engaged,
      free: (p.current_stock ?? 0) - engaged,
      last_counted_at: countedBy.get(p.id) ?? null,
      accuracy: accuracyBy.get(p.id) ?? null,
      series: seriesBy.get(p.id) ?? [],
    };
  });

  return NextResponse.json(
    { rows },
    { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" } },
  );
}
