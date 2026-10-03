import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { incomingByProduct } from "@/lib/receptions/incoming";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { lastDays, stockSeries, type SeriesLedgerRow } from "@/lib/warehouse/stock-series";

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
  /**
   * Where the units sit, per building. Empty in a market with one warehouse,
   * where a breakdown of a single line is noise.
   */
  sites: StockSiteRow[];
  /**
   * Units the buildings do not account for. The invariant is an INEQUALITY —
   * `sum(sites) <= products.current_stock` — so this gap is a real quantity
   * nobody has ventilated, not a rounding error to hide.
   */
  unallocated: number;
  /**
   * Units on order that have not reached the shelf — announced or declared
   * receptions, minus what has already been counted on them.
   *
   * NULL, never 0, when nothing is on the way: "nothing ordered" and "we do not
   * know" must not share a number, and a reassuring zero is the worse of the
   * two. See src/lib/receptions/incoming.ts for why a stale draft stops
   * counting — otherwise this figure would never come back down.
   */
  incoming: number | null;
  /**
   * The product's attribute variants (sizes, colours) and their stock. Pack
   * tiers are not here: a pack is not an object on a shelf. Empty for a product
   * that does not come in variants.
   */
  variants: StockVariantRow[];
}

export interface StockVariantRow {
  id: string;
  label: string;
  current_stock: number;
}

/** A building of the market, for the desk's one-column-per-building table. */
export interface StockWarehouse {
  id: string;
  code: string;
  name: string;
}

export interface WarehouseStockResponse {
  rows: WarehouseStockRow[];
  /**
   * The market's active buildings, in a stable order — empty in a market with
   * one building, where a breakdown of one line is noise (same rule as `sites`).
   */
  warehouses: StockWarehouse[];
}

export interface StockSiteRow {
  warehouse_id: string;
  code: string;
  name: string;
  current_stock: number;
  /** Null where nobody has ever counted THIS building's shelf. */
  last_counted_at: string | null;
}

/** Two weeks is what fits a 56px sparkline without the line becoming noise. */
const SERIES_DAYS = 14;
/**
 * Ceiling on the ledger rows read for the lines (newest first). A busy market
 * moves a few hundred units in two weeks; past the cap only the OLDEST days of
 * the line lose precision, never today's figure.
 */
const SERIES_ROW_CAP = 5000;
/** A count older than a quarter is not evidence about today's shelf. */
const ACCURACY_DAYS = 90;

/**
 * Statuses that hold a unit spoken for but still ON THE SHELF. `scanned` is
 * the stock boundary: scan_order_out already deducted those units, so counting
 * them again against current_stock invents a deficit (measured on the Libyan
 * bench: held 7, "engaged" 11, free −4, for a shelf that was fine).
 */
const ENGAGED_STATUSES = ["confirmed", "dispatch_scheduled", "uploaded"];

interface EngagedOrderRow {
  product_id: string | null;
  quantity: number | null;
  bench_cleared_at: string | null;
  carrier_extra: { fulfil_from_carrier_warehouse?: unknown } | null;
}

/**
 * Whether an order in an engaged status can still reach OUR shelf.
 *
 * Two kinds cannot, and both were counted until 2026-09-08. Orders the carrier
 * fulfils from its own warehouse never come here (Libya: 77 of 78 live
 * orders), and orders cleared off the bench on 23 August stay `uploaded` but
 * will never be scanned. Together they made "available 2" describe 214
 * parcels that would never touch the shelf. Reserved is our shelf only.
 */
function reservesOurShelf(o: EngagedOrderRow): boolean {
  if (o.bench_cleared_at) return false;
  const flag = o.carrier_extra?.fulfil_from_carrier_warehouse;
  return !(flag === true || flag === "true");
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  // The same rule as every other warehouse route: a super_admin sees the market
  // picked in the top bar (or an explicit ?market_id). This route read only the
  // parameter, so « Libye » picked still returned both markets' products — and,
  // mixed, no building breakdown at all.
  const { marketId } = resolveWarehouseScope(req, actor);

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
  if (ids.length === 0) return NextResponse.json({ rows: [], warehouses: [] } satisfies WarehouseStockResponse);

  // Engaged units and the last count are two small reads rather than a view,
  // so this route stays deletable without a migration behind it.
  const [
    { data: engagedRows }, { data: counts }, { data: seriesRows }, { data: accuracyData },
    { data: siteRows }, { data: warehouseRows }, { data: variantRows },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("product_id, quantity, bench_cleared_at, carrier_extra")
      .in("product_id", ids)
      .in("status", ENGAGED_STATUSES),
    supabase
      .from("inventory_log")
      .select("product_id, created_at")
      .in("product_id", ids)
      .eq("reason", "stock_count")
      .order("created_at", { ascending: false }),
    // The 14-day line. balance_after is on every inventory_log row and the
    // table is append-only, so the history needs no store of its own: ONE read
    // of the window's movements for every product, folded per day in
    // lib/warehouse/stock-series.ts. A day longer than the window, so the
    // first day's opening balance is known whatever the time zone.
    // (Not `get_product_stock_series`: it drew today's stock for every day
    // before the first movement, flattening the drop the line exists to show.)
    supabase
      .from("inventory_log")
      .select("product_id, change, balance_after, created_at")
      .in("product_id", ids)
      .gte("created_at", new Date(Date.now() - (SERIES_DAYS + 1) * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(SERIES_ROW_CAP),
    supabase.rpc("get_count_accuracy", { p_market_id: marketId ?? null, p_days: ACCURACY_DAYS }),
    // Where the units are. Libya runs two buildings and the ventilation has
    // existed in the database since September without ever reaching a screen —
    // an agent in Benghazi was reading Tripoli's shelf as part of their own.
    supabase
      .from("product_site_stock")
      .select("product_id, warehouse_id, variant_id, current_stock, last_counted_at")
      .in("product_id", ids),
    supabase
      .from("warehouses")
      .select("id, code, name_fr, name_ar, market_id, is_default")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("code", { ascending: true }),
    // The product page's « Variantes » card. Attribute variants only: a pack
    // tier multiplies a quantity, it holds no stock of its own.
    supabase
      .from("product_variants")
      .select("id, product_id, label, current_stock")
      .in("product_id", ids)
      .eq("kind", "attribute")
      .eq("is_active", true)
      .order("label", { ascending: true }),
  ]);

  const engagedBy = new Map<string, number>();
  for (const o of (engagedRows ?? []) as EngagedOrderRow[]) {
    if (!o.product_id || !reservesOurShelf(o)) continue;
    engagedBy.set(o.product_id, (engagedBy.get(o.product_id) ?? 0) + (o.quantity ?? 0));
  }
  const countedBy = new Map<string, string>();
  for (const c of counts ?? []) {
    if (c.product_id && !countedBy.has(c.product_id)) countedBy.set(c.product_id, c.created_at);
  }

  const ledgerBy = new Map<string, SeriesLedgerRow[]>();
  for (const r of (seriesRows ?? []) as Array<SeriesLedgerRow & { product_id: string }>) {
    const bucket = ledgerBy.get(r.product_id);
    if (bucket) bucket.push(r);
    else ledgerBy.set(r.product_id, [r]);
  }

  /*
   * One building is not a breakdown. Tunisia has a single warehouse, so
   * ventilating its total across "one site" would add a line that repeats the
   * figure above it. Only a market that can actually split shows the split.
   */
  /*
   * A market, not "every warehouse there is".
   *
   * A super_admin with no market selected has `marketId === null`, so an
   * unfiltered list mixes Tunisia's warehouse with Libya's two — and `multiSite`
   * would then be true for a Tunisian product, inventing a breakdown for a
   * market that has one building. The products all belong to one market when a
   * scope is set; when none is, the split is not meaningful and is skipped.
   */
  const productMarkets = new Set(
    ((products ?? []) as Array<{ market_id: string | null }>)
      .map((p) => p.market_id)
      .filter((m): m is string => Boolean(m)),
  );
  const scopeMarket = marketId ?? (productMarkets.size === 1 ? [...productMarkets][0] : null);

  const marketWarehouses = ((warehouseRows ?? []) as Array<{
    id: string; code: string; name_fr: string; name_ar: string; market_id: string;
  }>).filter((w) => scopeMarket !== null && w.market_id === scopeMarket);
  const multiSite = marketWarehouses.length > 1;
  // Libya reads Arabic. The site name is a place painted on a wall, so it is
  // never translated by key — it is picked, like everywhere else in the shell.
  const arabicNames = marketIdToCode(scopeMarket) === "ly";
  // A day closes at midnight in the MARKET, not in UTC.
  const seriesZone = marketTimezone(scopeMarket);
  const seriesDays = lastDays(SERIES_DAYS, seriesZone);
  const warehouseById = new Map(marketWarehouses.map((w) => [w.id, w]));

  const sitesBy = new Map<string, StockSiteRow[]>();
  if (multiSite) {
    for (const r of (siteRows ?? []) as Array<{
      product_id: string; warehouse_id: string; current_stock: number | null; last_counted_at: string | null;
    }>) {
      const w = warehouseById.get(r.warehouse_id);
      if (!w) continue;
      const bucket = sitesBy.get(r.product_id) ?? [];
      /*
       * ONE line per building. `product_site_stock` is keyed (product, variant,
       * site), so a product with sizes keeps several rows per building; the
       * building holds their sum, and was last counted when any of them was.
       */
      const same = bucket.find((l) => l.warehouse_id === r.warehouse_id);
      if (same) {
        same.current_stock += r.current_stock ?? 0;
        if (r.last_counted_at && (!same.last_counted_at || r.last_counted_at > same.last_counted_at)) {
          same.last_counted_at = r.last_counted_at;
        }
        continue;
      }
      bucket.push({
        warehouse_id: r.warehouse_id,
        code: w.code,
        // The name painted on the wall, in the market's language. Libya's bench
        // reads Arabic; `name_ar` was selected and thrown away.
        name: (arabicNames ? w.name_ar : w.name_fr) || w.name_fr,
        current_stock: r.current_stock ?? 0,
        last_counted_at: r.last_counted_at ?? null,
      });
      sitesBy.set(r.product_id, bucket);
    }
    // Buildings in a stable order — the warehouses table's, not the arrival
    // order of the stock rows, which would reshuffle the card between refreshes.
    const rank = new Map(marketWarehouses.map((w, i) => [w.id, i]));
    for (const lines of sitesBy.values()) {
      lines.sort((a, b) => (rank.get(a.warehouse_id) ?? 0) - (rank.get(b.warehouse_id) ?? 0));
    }
  }

  /*
   * Ce qui est en route. Une seule requête, filtrée sur les deux seuls statuts
   * qui peuvent compter — la règle de péremption d'un brouillon est appliquée
   * en TypeScript, testée, plutôt que dupliquée en SQL.
   */
  let incomingQuery = supabase
    .from("receptions")
    .select("status, expected_at, reception_lines(product_id, expected_qty, received_qty)")
    .in("status", ["draft", "submitted"]);
  if (scopeMarket) incomingQuery = incomingQuery.eq("market_id", scopeMarket);
  const { data: incomingRows } = await incomingQuery;

  const incomingBy = incomingByProduct(
    ((incomingRows ?? []) as unknown as Array<{
      status: string;
      expected_at: string | null;
      reception_lines: Array<{
        product_id: string;
        expected_qty: number | null;
        received_qty: number | null;
      }> | null;
    }>).map((r) => ({
      status: r.status,
      expected_at: r.expected_at,
      lines: r.reception_lines ?? [],
    })),
  );

  const variantsBy = new Map<string, StockVariantRow[]>();
  for (const v of (variantRows ?? []) as Array<{
    id: string; product_id: string; label: string; current_stock: number | null;
  }>) {
    const bucket = variantsBy.get(v.product_id) ?? [];
    bucket.push({ id: v.id, label: v.label, current_stock: v.current_stock ?? 0 });
    variantsBy.set(v.product_id, bucket);
  }

  const accuracyBy = new Map<string, number | null>();
  for (const a of ((accuracyData as { products?: Array<{ product_id: string; accuracy: number | null }> } | null)
    ?.products ?? [])) {
    accuracyBy.set(a.product_id, a.accuracy);
  }

  const rows: WarehouseStockRow[] = (products ?? []).map((p) => {
    const engaged = engagedBy.get(p.id) ?? 0;
    const goal = typeof p.stock_goal === "number" ? p.stock_goal : null;
    const sites = sitesBy.get(p.id) ?? [];
    const allocated = sites.reduce((n, s) => n + s.current_stock, 0);
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
      series: stockSeries(ledgerBy.get(p.id) ?? [], p.current_stock ?? 0, seriesDays, seriesZone),
      sites,
      // Absent de la Map = rien en route. On rend null, pas 0.
      incoming: incomingBy.get(p.id) ?? null,
      /*
       * The gap between the market total and what the buildings account for.
       *
       * Zero in a one-warehouse market, where there is no breakdown at all: the
       * whole stock would otherwise read as "unallocated", which is the exact
       * opposite of the truth. In a market with several buildings and nothing
       * counted it is the WHOLE register — it read 0 until 2026-10-02, which
       * said the buildings accounted for everything when they accounted for
       * nothing. Clamped at zero above too — a site holding more than the market
       * total is a broken invariant to investigate, not a negative quantity to
       * paint on a card.
       */
      unallocated: multiSite ? Math.max((p.current_stock ?? 0) - allocated, 0) : 0,
      variants: variantsBy.get(p.id) ?? [],
    };
  });

  const body: WarehouseStockResponse = {
    rows,
    warehouses: multiSite
      ? marketWarehouses.map((w) => ({
          id: w.id,
          code: w.code,
          name: (arabicNames ? w.name_ar : w.name_fr) || w.name_fr,
        }))
      : [],
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" },
  });
}
