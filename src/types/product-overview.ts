// Wire types for Produits v6 — the list, the product sheet and the edit page's
// calculator (plans/products-redesign-v6.md, prototypes/products-v6.html).
//
// Every figure here is computed on the server from get_product_cohort: orders
// RECEIVED in the period, each followed to today. The client formats, sorts and
// filters; it never derives money.

import type { CohortCounts, FailureCause, ProductSignal } from "@/lib/products/cohort";

export type { CohortCounts, FailureCause, ProductSignal };

export interface OverviewPeriod {
  from: string;
  to: string;
  /** Market timezone the days are cut in. */
  tz: string;
  /** Every market-local day of the window, YYYY-MM-DD. */
  days: string[];
}

export interface RowMoney {
  deliveries: number;
  paid: number;
  carrier: number;
  encaisse: number;
  cogs: number;
  packing: number;
  processing: number;
  ads: number;
  net: number;
}

export type CostShareKey = "carrier" | "cogs" | "packing" | "processing" | "ads" | "profit";

export interface CostShare {
  key: CostShareKey;
  share: number;
  amount: number;
}

export interface ProductOverviewRow {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  is_active: boolean;
  default_price: number | null;
  current_stock: number;
  low_stock_threshold: number;
  counts: CohortCounts;
  confirmation: number | null;
  delivery: number | null;
  provisional: boolean;
  money: RowMoney;
  margin: number | null;
  shares: CostShare[];
  /** Orders received per day of the window. */
  spark: number[];
  units_left_30d: number;
  /** Days of stock at the last 30 days' pace; null when nothing left. */
  cover: number | null;
  signal: ProductSignal | null;
}

export interface ProductsOverviewResponse {
  period: OverviewPeriod;
  currency: string;
  lead_days: number;
  market: {
    last_order_at: string | null;
    last_ad_day: string | null;
    /** True once any active product has been counted (record_stock_count). */
    any_counted: boolean;
    /** Darb's average invoice over the last 30 days. */
    avg_delivery_cost: number | null;
  };
  /** Active products only — a KPI must not move when a filter changes. */
  totals: {
    active: number;
    received: number;
    uploaded: number;
    rejected: number;
    delivered: number;
    failed: number;
    in_flight: number;
    paid: number;
    carrier: number;
    encaisse: number;
    ads: number;
    net: number;
    confirmation: number | null;
    delivery: number | null;
    margin: number | null;
    final: number | null;
    spark: number[];
  };
  rows: ProductOverviewRow[];
}

export interface PerDeliveryFigures {
  paid: number;
  carrier: number;
  encaisse: number;
  cogs: number;
  packing: number;
  processing: number;
  beforeAds: number;
  ads: number;
  net: number;
}

export interface SheetAgentRow {
  agent_id: string;
  name: string;
  avatar_url: string | null;
  assigned: number;
  attempts: number;
  uploaded: number;
  rejected: number;
  delivered: number;
  failed: number;
  in_flight: number;
}

export interface StockMove {
  at: string;
  reason: string;
  change: number;
  balance_after: number | null;
}

export interface ProductSheetOverviewResponse {
  period: OverviewPeriod;
  currency: string;
  lead_days: number;
  counts: CohortCounts;
  confirmation: number | null;
  delivery: number | null;
  provisional: boolean;
  final: number | null;
  money: RowMoney & {
    units: number;
    parcels: number;
    confirmed: number;
    /** Delivered parcels priced at the market average (no invoice, no quote). */
    carrier_estimated: number;
  };
  margin: number | null;
  per_delivery: PerDeliveryFigures | null;
  break_even: number | null;
  shares: CostShare[];
  insight: {
    ads_per_delivery: number;
    ads_share_of_paid: number;
    /** Carrier + product + packaging + processing per delivery. */
    other_per_delivery: number;
  } | null;
  why: {
    rejections: { group: string; count: number }[];
    failures: { cause: FailureCause; count: number }[];
  };
  trend: {
    received: number[];
    delivered: number[];
    ads: number[];
    /** Index of the market's last order when intake has stopped; null otherwise. */
    stop_index: number | null;
    stop_at: string | null;
  };
  agents: {
    rows: SheetAgentRow[];
    unassigned: { assigned: number; uploaded: number };
  };
  stock: {
    counted_at: string | null;
    scanned_30d: number;
    returned_30d: number;
    units_left_30d: number;
    cover: number | null;
    moves: StockMove[];
  };
  last_order_at: string | null;
  avg_delivery_cost: number | null;
}
