// Facets, counts, sorting and query parsing for the /products list.
//
// ── WHY EVERYTHING DERIVES FROM ONE PREDICATE ─────────────────────────────
// The defect this module exists to kill: /products filtered and sorted
// CLIENT-SIDE over the 25 rows of the current page while `total` came from the
// server, so "Stock bas" only ever found low stock on page 1 and the range
// label disagreed with the total. Fixing that means the count shown on a tile
// and the row set that tile opens must be produced by the SAME code — not by
// two implementations that agree today. Hence: one `predicateForFacet`, and
// `applyFacet` / `computeFacetCounts` both call it. The invariant
// `computeFacetCounts(rows)[f] === applyFacet(rows, f).length` then holds by
// construction rather than by convention, and is asserted in the tests.

import { isLowStock } from "@/lib/product-calculations";
import { lastNDaysPeriod } from "@/lib/date";
import {
  DEFAULT_PRODUCT_PAGE_SIZE,
  DEFAULT_PRODUCT_PERIOD_DAYS,
  METRIC_FACETS,
  METRIC_SORT_KEYS,
  PRODUCT_FACETS,
  PRODUCT_PAGE_SIZES,
  PRODUCT_SORT_KEYS,
  THIN_MARGIN_CEILING_PCT,
  type ProductFacet,
  type ProductFacetCounts,
  type ProductHighlights,
  type ProductListRow,
  type ProductSortKey,
  type SortDirection,
} from "@/types/product-list";

export type ProductRowPredicate = (row: ProductListRow) => boolean;

export function predicateForFacet(facet: ProductFacet): ProductRowPredicate {
  switch (facet) {
    case "active":
      return (r) => r.is_active === true;
    case "inactive":
      return (r) => r.is_active === false;
    case "outOfStock":
      return (r) => r.current_stock <= 0;
    case "lowStock":
      // Reuses isLowStock so the `threshold === 0 → never low` rule lives in
      // exactly one place. A product with threshold 0 and stock 0 is
      // out-of-stock but NOT low-stock — the facets deliberately overlap
      // elsewhere, so never present them as a partition.
      return (r) => isLowStock(r.current_stock, r.low_stock_threshold);
    case "losingMoney":
      // net_profit, NOT margin_pct. The canonical formula returns margin_pct 0
      // when revenue is 0, so a product that burned ad spend with no deliveries
      // has margin 0 — it belongs to `noSales`, and testing net_profit here
      // keeps a real loss from hiding behind a zero margin.
      return (r) => r.metrics !== null && r.metrics.net_profit < 0;
    case "thinMargin":
      // Strictly positive and at or below the ceiling: a loss is not a thin
      // margin (it has its own facet), and a 0 % margin means no revenue.
      return (r) =>
        r.metrics !== null &&
        r.metrics.margin_pct > 0 &&
        r.metrics.margin_pct <= THIN_MARGIN_CEILING_PCT;
    case "noSales":
      return (r) => r.metrics !== null && r.metrics.total_leads === 0;
    case "all":
    default:
      return () => true;
  }
}

export function applyFacet(rows: ProductListRow[], facet: ProductFacet): ProductListRow[] {
  return rows.filter(predicateForFacet(facet));
}

/**
 * Counts every facet through the same predicate `applyFacet` uses.
 *
 * Metric-dependent keys are OMITTED (not set to 0) when no row carries metrics,
 * so a caller without profitability permission renders no such filter instead
 * of a zero that reads as "there are none".
 */
export function computeFacetCounts(rows: ProductListRow[]): ProductFacetCounts {
  const hasMetrics = rows.some((r) => r.metrics !== null);
  const counts: ProductFacetCounts = {};
  for (const facet of PRODUCT_FACETS) {
    if (!hasMetrics && METRIC_FACETS.includes(facet) && rows.length > 0) continue;
    counts[facet] = applyFacet(rows, facet).length;
  }
  return counts;
}

export function facetNeedsMetrics(facet: ProductFacet): boolean {
  return METRIC_FACETS.includes(facet);
}

export function sortNeedsMetrics(sort: ProductSortKey): boolean {
  return METRIC_SORT_KEYS.includes(sort);
}

// Postgres `ORDER BY name` sorts Arabic under the DB collation; Intl.Collator
// with numeric:true also puts "item 2" before "item 10".
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function metricValue(row: ProductListRow, key: ProductSortKey): number | null {
  if (row.metrics === null) return null;
  const m = row.metrics;
  switch (key) {
    case "revenue":
      return m.revenue;
    case "net_profit":
      return m.net_profit;
    case "margin_pct":
      return m.margin_pct;
    case "confirmation_rate":
      return m.confirmation_rate;
    case "delivery_rate":
      return m.delivery_rate;
    case "return_rate":
      return m.return_rate;
    case "total_leads":
      return m.total_leads;
    default:
      return null;
  }
}

/**
 * Always returns a TOTAL order.
 *
 * Every comparator ends with the same tie-break — name, then id, ALWAYS
 * ascending regardless of `dir`. This is correctness, not polish: over a 30-day
 * window most revenue and profit values are 0, so ties are the common case, and
 * a non-total order lets `.slice()` pagination repeat a page-1 row on page 2 or
 * skip one entirely. Flipping direction must not reshuffle ties either, or page
 * boundaries move under the user.
 */
export function comparatorFor(
  sort: ProductSortKey,
  dir: SortDirection,
): (a: ProductListRow, b: ProductListRow) => number {
  const sign = dir === "desc" ? -1 : 1;
  return (a, b) => {
    let d = 0;
    switch (sort) {
      case "name":
        d = collator.compare(a.name, b.name);
        break;
      case "current_stock":
        d = a.current_stock - b.current_stock;
        break;
      case "unit_cogs":
        d = a.unit_cogs - b.unit_cogs;
        break;
      case "is_active":
        d = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0);
        break;
      default: {
        // A row with no metrics sorts as the lowest possible value, so under
        // `desc` (the common case for money columns) it lands last.
        const x = metricValue(a, sort);
        const y = metricValue(b, sort);
        if (x === y) d = 0;
        else if (x === null) d = -1;
        else if (y === null) d = 1;
        else d = x - y;
      }
    }
    if (d !== 0) return d * sign;
    const byName = collator.compare(a.name, b.name);
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export function sortRows(
  rows: ProductListRow[],
  sort: ProductSortKey,
  dir: SortDirection,
): ProductListRow[] {
  return rows.slice().sort(comparatorFor(sort, dir));
}

// ── query parsing ───────────────────────────────────────────────────────────

export interface ProductListQuery {
  q: string;
  filter: ProductFacet;
  sort: ProductSortKey;
  dir: SortDirection;
  from_date: string;
  to_date: string;
  page: number;
  limit: number;
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isIsoDate(v: string | null): v is string {
  return v !== null && ISO_DATE.test(v);
}

/**
 * Lenient by design: an unknown `filter` or `sort` falls back to the default
 * rather than 400-ing, so a stale bookmark still renders a usable page. What is
 * NOT lenient is the date format — a malformed date is dropped rather than
 * handed to PostgREST.
 */
export function parseProductListQuery(params: URLSearchParams): ProductListQuery {
  const rawFilter = params.get("filter");
  const filter = (PRODUCT_FACETS as readonly string[]).includes(rawFilter ?? "")
    ? (rawFilter as ProductFacet)
    : "all";

  const rawSort = params.get("sort");
  const sort = (PRODUCT_SORT_KEYS as readonly string[]).includes(rawSort ?? "")
    ? (rawSort as ProductSortKey)
    : "name";

  const rawDir = params.get("dir");
  const dir: SortDirection = rawDir === "desc" || rawDir === "asc" ? rawDir : "asc";

  const rawPage = Number(params.get("page") ?? "1");
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawLimit = Number(params.get("limit") ?? DEFAULT_PRODUCT_PAGE_SIZE);
  const limit = (PRODUCT_PAGE_SIZES as readonly number[]).includes(rawLimit)
    ? rawLimit
    : DEFAULT_PRODUCT_PAGE_SIZE;

  const fallback = lastNDaysPeriod(DEFAULT_PRODUCT_PERIOD_DAYS);
  const rawFrom = params.get("from_date");
  const rawTo = params.get("to_date");

  return {
    q: (params.get("q") ?? "").trim(),
    filter,
    sort,
    dir,
    from_date: isIsoDate(rawFrom) ? rawFrom : fallback.from_date,
    to_date: isIsoDate(rawTo) ? rawTo : fallback.to_date,
    page,
    limit,
  };
}

/** Inverse of parseProductListQuery. Omits defaults so shared URLs stay short. */
export function productListQueryToParams(
  query: Partial<ProductListQuery>,
  opts: { omitDefaults?: boolean } = {},
): URLSearchParams {
  const omit = opts.omitDefaults ?? false;
  const p = new URLSearchParams();
  const put = (key: string, value: string | undefined, dflt?: string) => {
    if (value === undefined || value === "") return;
    if (omit && dflt !== undefined && value === dflt) return;
    p.set(key, value);
  };
  put("q", query.q);
  put("filter", query.filter, "all");
  put("sort", query.sort, "name");
  put("dir", query.dir, "asc");
  put("from_date", query.from_date);
  put("to_date", query.to_date);
  put("page", query.page === undefined ? undefined : String(query.page), "1");
  put(
    "limit",
    query.limit === undefined ? undefined : String(query.limit),
    String(DEFAULT_PRODUCT_PAGE_SIZE),
  );
  return p;
}

// ── roll-ups ────────────────────────────────────────────────────────────────

/**
 * Top earner and worst margin over the FULL enriched set.
 *
 * PortfolioStrip derived these from the 25 rows of the current page, which made
 * them market-wide wrong. They are navigation (they link to a product), not
 * filters, so they are not bound by the counts-must-match-the-view rule.
 */
export function computeHighlights(rows: ProductListRow[]): ProductHighlights {
  let top: ProductListRow | null = null;
  let worst: ProductListRow | null = null;
  for (const r of rows) {
    const m = r.metrics;
    if (!m) continue;
    if (m.revenue > 0 && (top === null || m.revenue > top.metrics!.revenue)) top = r;
    // A 0 % margin means no revenue, not a bad margin — guard on revenue.
    if (m.revenue > 0 && (worst === null || m.margin_pct < worst.metrics!.margin_pct)) worst = r;
  }
  return {
    top_earner: top ? { id: top.id, name: top.name, value: top.metrics!.revenue } : null,
    worst_margin: worst
      ? { id: worst.id, name: worst.name, value: worst.metrics!.margin_pct }
      : null,
  };
}

/**
 * Mutually exclusive stock split for the KPI composition bar.
 *
 * `outOfStock` and `lowStock` overlap as facets, which is correct for filtering
 * but wrong for a stacked bar — segments that double-count would over-fill it.
 * Here `low_only_count` excludes anything already counted as out of stock.
 */
export function computeStockSplit(rows: ProductListRow[]): {
  healthy_count: number;
  low_only_count: number;
  out_of_stock_count: number;
} {
  let out = 0;
  let lowOnly = 0;
  for (const r of rows) {
    if (r.current_stock <= 0) out += 1;
    else if (isLowStock(r.current_stock, r.low_stock_threshold)) lowOnly += 1;
  }
  return {
    healthy_count: rows.length - out - lowOnly,
    low_only_count: lowOnly,
    out_of_stock_count: out,
  };
}
