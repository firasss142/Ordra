/**
 * Contract for the stock console. Types and constants only — NO Supabase import,
 * NO `next/server`, so client components can import it freely.
 *
 * This module exists because `lib/calculations/**` is server-only (see that
 * directory's CLAUDE.md) and the old page imported its response type straight
 * from the route module, dragging `next/server` into the client bundle.
 */
import type { Confidence } from "@/lib/dashboard/confidence";

export const DEMAND_WINDOW_OPTIONS = [7, 28, 90] as const;
export type DemandWindowDays = (typeof DEMAND_WINDOW_OPTIONS)[number];
export const DEFAULT_DEMAND_WINDOW: DemandWindowDays = 28;

/**
 * Return rate is measured on a fixed window, independent of the demand selector.
 * At 7 days every product falls under the confidence floor and the column would
 * always be blank — the same reason `get_dashboard_health` pins its carrier window.
 */
export const RETURN_RATE_WINDOW_DAYS = 90;

/** Cover beyond this is capital sitting still, not inventory. */
export const OVERSTOCK_COVER_DAYS = 90;

/** Cover at or under this is the "act this week" band on the cover tile. */
export const COVER_URGENT_DAYS = 7;
/** Cover at or under this is the "watch" band. */
export const COVER_WATCH_DAYS = 45;

export const SUPPLIER_LEAD_TIME_SETTING_KEY = "supplier_lead_time_days";

export interface DemandPoint {
  /** Bucket START, YYYY-MM-DD UTC. Spans `demand_bucket_days`. */
  day: string;
  units: number;
  orders: number;
}

export type StockState =
  | "out" // free-to-sell <= 0 — oversold or empty
  | "reorder_now" // the reorder date has already passed
  | "watch" // runs out inside the lead time plus a margin
  | "ok"
  | "overstocked" // more than OVERSTOCK_COVER_DAYS of cover
  | "dead" // no demand at all in the window, stock on the shelf
  | "unknown"; // demand sample too thin to judge — no cover is shown

/**
 * Where a product's stock physically sits, which decides whose number is
 * authoritative. Libya's catalogue is held by Darb Assabil, so `current_stock`
 * for those rows is a local record of someone else's shelf.
 */
export type StockSource = "own" | "carrier";

export interface StockProduct {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  market_id: string;

  source: StockSource;
  carrier_name: string | null;

  /* ── position, in units ── */
  physical_stock: number;
  /** In-flight units NOT yet deducted from `physical_stock`. */
  committed: number;
  committed_orders: number;
  /** In-flight units that DO carry a scan row — already out of `physical_stock`. */
  committed_already_deducted: number;
  /** physical_stock − committed. SIGNED — never clamped, a deficit is the signal. */
  free_to_sell: number;
  coming_back: number;

  /* ── demand and cover ── */
  demand_units: number;
  demand_orders: number;
  /** min(window, age of first shipment), floored at 1. */
  effective_window_days: number;
  demand_rate_per_day: number;
  demand_series: DemandPoint[];
  demand_bucket_days: number;
  /** True when most in-window demand was inferred from created_at. */
  demand_is_inferred: boolean;

  days_of_cover: number | null;
  stock_out_date: string | null;
  /** stock_out_date − lead_time_days. May be in the PAST; that is the alarm. */
  reorder_by_date: string | null;
  lead_time_days: number;

  /* ── returns, fixed 90-day window ── */
  return_rate: number | null;
  return_sample_orders: number;
  return_confidence: Confidence;
  damaged_rate: number;
  is_damaged_outlier: boolean;

  /* ── capital ── */
  unit_cogs: number;
  stock_value: number;
  engaged_value: number;
  active_value: number;
  dormant_value: number;
  last_sale_at: string | null;
  days_since_last_sale: number | null;

  /* ── reconciliation ── */
  expected_stock: number;
  /** physical_stock − expected_stock. Unreconciled units, NOT shrinkage. */
  drift_units: number;
  drift_value: number;
  ledger_rows: number;
  awaiting_scan_orders: number;
  awaiting_scan_units: number;
  oldest_awaiting_scan_days: number | null;
  last_counted_at: string | null;
  days_since_count: number | null;

  confidence: Confidence;
  state: StockState;
  low_stock_threshold: number;
}

export interface StockTotals {
  products: number;
  physical_units: number;
  committed_units: number;
  free_to_sell_units: number;

  stock_value: number;
  engaged_value: number;
  active_value: number;
  dormant_value: number;
  /** dormant_value / stock_value, 0-1. */
  dormant_share: number;
  dormant_products: number;
  dormant_units: number;
  /** Mean days since last sale across dormant products. */
  dormant_avg_age_days: number | null;

  /** Shortest cover across products that have one — the "jours avant rupture" figure. */
  min_days_of_cover: number | null;
  min_cover_product_id: string | null;
  min_cover_stock_out_date: string | null;
  cover_ok_count: number;
  cover_watch_count: number;
  cover_urgent_count: number;

  drift_units: number;
  drift_value: number;
  drift_products: number;
  /** drift_products / products, 0-1. */
  drift_share: number;
  /** drift_value spread over the age of the oldest unscanned shipment. */
  drift_daily_impact: number;

  awaiting_scan_orders: number;
  awaiting_scan_units: number;
  oldest_awaiting_scan_days: number | null;
}

/** Why the page may be lying. Rendered as a band, not buried in a panel. */
export interface LedgerHealth {
  inventory_log_rows: number;
  scan_out_rows: number;
  /** Units the order flow says left the shelf with no matching scan row. */
  unscanned_shipped_units: number;
  unscanned_shipped_value: number;
  last_movement_at: string | null;
  /** Products whose stock is physically held by a carrier. */
  carrier_held_products: number;
}

export type StockActionKind = "relaunch" | "expedite" | "liquidate" | "reduce_moq" | "scan";

export interface StockAction {
  kind: StockActionKind;
  product_id: string | null;
  product_name: string | null;
  /** Money recoverable or protected, in the scope currency. */
  amount: number;
  /** Machine-readable detail; the UI supplies the wording. */
  detail: Record<string, number | string | null>;
}

export interface StockPosition {
  window: { from: string; to: string; days: DemandWindowDays; bucket_days: number };
  return_rate_window: { from: string; to: string; days: number };
  scope: "single" | "all";
  market_id: string | null;
  currency: string | null;
  /** True when the scope mixes currencies and money must not be summed. */
  mixed_currencies: boolean;
  generated_at: string;
  totals: StockTotals;
  ledger: LedgerHealth;
  actions: StockAction[];
  products: StockProduct[];
}
