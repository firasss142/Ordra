// Wire + view types for the /products list surface.
//
// Deliberately NOT an extension of `Product` in ./product.ts. That interface is
// the full DB row (created_at, agent_brief, agent_content_updated_by, …). A list
// row is a projection plus derived fields. Conflating the two is how this repo
// ended up with eight competing product-shaped interfaces; this file replaces
// six of them:
//   ProductRow      (ProductsPageClient.tsx, ProductCatalogRow.tsx)
//   BulkProductMetrics                (api/products/profitability-bulk/route.ts)
//   PortfolioProduct / PortfolioMetrics             (PortfolioStrip.tsx)
//   SortableProduct / ProductSortKey                (lib/product-sort.ts)
//   ProductFilterStatus                             (ProductsFilterBar.tsx)
// Left alone on purpose — different surfaces, different projections:
//   ProductSheetProduct, ProductIntelligence, EditableProduct.
//
// snake_case throughout, mirroring the JSON exactly, so there is no translation
// layer between wire and type.

/** Period-scoped figures. Every field here moves when the date range moves. */
export interface ProductPeriodMetrics {
  total_leads: number;
  confirmed_count: number;
  dispatched_count: number;
  delivered_count: number;
  returned_count: number;
  confirmation_rate: number;
  delivery_rate: number;
  return_rate: number;
  revenue: number;
  /** `simplifiedNetProfit` in lib/calculations — renamed once, in toWireMetrics(). */
  net_profit: number;
  margin_pct: number;
  cost_per_delivered: number;

  /**
   * Every cost line, so the drawer's composition chart reconciles:
   *   revenue − (cogs + delivery + return + packing + processing + ad_spend)
   *     === net_profit
   * Delivery and return CANNOT be derived on the client — each is summed per
   * order at that order's own carrier's fee, so the client has no way to
   * reconstruct them from counts. Omitting them left two bars off the chart and
   * made the rest fail to add up.
   */
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  processing_cost: number;
  ad_spend: number;
}

export interface ProductListRow {
  id: string;
  market_id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost: number;
  default_price: number | null;
  initial_stock: number;
  current_stock: number;
  system_inventory: number;
  real_inventory: number;
  low_stock_threshold: number;
  damaged_return_count: number;
  is_active: boolean;
  variant_count: number;
  /**
   * `null` means NOT PERMITTED / NOT REQUESTED — distinct from an all-zero
   * object, which means "no activity in this period". Conflating those two is
   * the same class of mistake as `is_active === undefined → !undefined → true`,
   * and the `noSales` facet depends on the distinction being real.
   */
  metrics: ProductPeriodMetrics | null;
}

export const PRODUCT_FACETS = [
  "all",
  "active",
  "inactive",
  "outOfStock",
  "lowStock",
  "losingMoney",
  "thinMargin",
  "noSales",
] as const;
export type ProductFacet = (typeof PRODUCT_FACETS)[number];

/** Facets that cannot be evaluated without period metrics. */
export const METRIC_FACETS: readonly ProductFacet[] = [
  "losingMoney",
  "thinMargin",
  "noSales",
] as const;

export const PRODUCT_SORT_KEYS = [
  "name",
  "current_stock",
  "unit_cogs",
  "revenue",
  "net_profit",
  "margin_pct",
  "confirmation_rate",
  "delivery_rate",
  "return_rate",
  "total_leads",
  "is_active",
] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];

/** Sort keys that read out of `row.metrics` rather than the base row. */
export const METRIC_SORT_KEYS: readonly ProductSortKey[] = [
  "revenue",
  "net_profit",
  "margin_pct",
  "confirmation_rate",
  "delivery_rate",
  "return_rate",
  "total_leads",
] as const;

export type SortDirection = "asc" | "desc";

/**
 * Partial, not Record: a key is ABSENT (never 0) when metrics were unavailable,
 * so the UI can omit that filter rather than render a lying zero.
 *
 * These counts are NOT a partition — a product with `low_stock_threshold > 0`
 * and `current_stock <= 0` counts under both `outOfStock` and `lowStock`. Never
 * present them as summing to `all`.
 */
export type ProductFacetCounts = Partial<Record<ProductFacet, number>>;

export interface ProductHighlight {
  id: string;
  name: string;
  value: number;
}

export interface ProductHighlights {
  top_earner: ProductHighlight | null;
  worst_margin: ProductHighlight | null;
}

export interface ProductListPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  rangeFrom: number;
  rangeTo: number;
}

export interface ProductListPeriod {
  from_date: string;
  to_date: string;
}

/** Portfolio roll-up for the KPI cards. Market-wide, never page-scoped. */
export interface ProductListTotals {
  stock_value: number;
  stock_units: number;
  revenue: number;
  net_profit: number;
  margin_pct: number;
  /**
   * Previous period of equal length, for the KPI delta pills. `null` means "not
   * loaded yet" — it arrives from a SEPARATE request.
   *
   * Measured on the Libya market: the current 30-day window transports ~611
   * rows, the previous one ~4,666 (7.6x), and two of its fetches cross
   * fetchAllRows' 1000-row page boundary and therefore serialise into extra
   * round trips. Paying all of that on the blocking request — to render two
   * percentages decorating figures that are already on screen — is what made
   * the page feel slow. See /api/products/list/previous.
   */
  previous_revenue: number | null;
  previous_net_profit: number | null;
  /** Stock-state split for the composition bar. Mutually exclusive by construction. */
  healthy_count: number;
  low_only_count: number;
  out_of_stock_count: number;
}

export interface ProductListResponse {
  data: ProductListRow[];
  pagination: ProductListPagination;
  facets: ProductFacetCounts;
  highlights: ProductHighlights;
  totals: ProductListTotals;
  period: ProductListPeriod;
  currency: string;
}

export const PRODUCT_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PRODUCT_PAGE_SIZE = 25;
export const DEFAULT_PRODUCT_PERIOD_DAYS = 30;
/** A positive margin at or below this is "thin". Not a cost variable — a display threshold. */
export const THIN_MARGIN_CEILING_PCT = 10;
