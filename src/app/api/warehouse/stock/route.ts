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
  current_stock: number;
  low_stock_threshold: number;
  damaged_return_count: number;
  /** Units already committed to orders that have left the agent queue. */
  engaged: number;
  /** current_stock - engaged. Negative means we owe more than we hold. */
  free: number;
  last_counted_at: string | null;
}

/** Statuses that hold a unit spoken for but not yet delivered. */
const ENGAGED_STATUSES = ["uploaded", "scanned", "dispatched", "deposit", "in_transit"];

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
    .select("id, name, current_stock, low_stock_threshold, damaged_return_count, market_id")
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
  const [{ data: engagedRows }, { data: counts }] = await Promise.all([
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

  const rows: WarehouseStockRow[] = (products ?? []).map((p) => {
    const engaged = engagedBy.get(p.id) ?? 0;
    return {
      product_id: p.id,
      name: p.name,
      current_stock: p.current_stock ?? 0,
      low_stock_threshold: p.low_stock_threshold ?? 0,
      damaged_return_count: p.damaged_return_count ?? 0,
      engaged,
      free: (p.current_stock ?? 0) - engaged,
      last_counted_at: countedBy.get(p.id) ?? null,
    };
  });

  return NextResponse.json(
    { rows },
    { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" } },
  );
}
