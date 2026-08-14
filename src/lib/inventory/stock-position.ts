/**
 * Loader for the stock console: one RPC call, then all derivation in JS.
 *
 * `mapStockPayload` is exported and pure so the whole shape can be tested
 * without a database — the same split `lib/dashboard/health.ts` uses.
 */
import { createClient } from "@/lib/supabase/server";
import {
  lastNDaysPeriod,
  lastNDaysEndingAt,
  todayISO,
} from "@/lib/date";
import {
  effectiveWindowDays,
  demandRatePerDay,
  demandConfidence,
  daysOfCover,
  stockOutDate,
  reorderByDate,
  returnRate,
  computeDrift,
  chooseBucketDays,
  classifyStockState,
  splitCapital,
  damagedRate,
  isDamagedOutlier,
  daysBetweenISO,
} from "@/lib/calculations/inventory-intelligence";
import {
  DEFAULT_DEMAND_WINDOW,
  RETURN_RATE_WINDOW_DAYS,
  COVER_URGENT_DAYS,
  COVER_WATCH_DAYS,
  OVERSTOCK_COVER_DAYS,
  type DemandWindowDays,
  type DemandPoint,
  type StockPosition,
  type StockProduct,
  type StockTotals,
  type LedgerHealth,
  type StockAction,
} from "./stock-position-types";
import { classifyConfidence } from "@/lib/dashboard/confidence";
import { DEFAULT_SUPPLIER_LEAD_TIME_DAYS } from "@/types/settings";

/** PostgREST hands BIGINT back as a string; coerce before any arithmetic. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export interface RpcProductRow {
  [key: string]: unknown;
}

export interface RpcPayload {
  products?: RpcProductRow[];
  ledger_health?: Record<string, unknown>;
}

export interface MapStockOptions {
  windowDays: DemandWindowDays;
  window: { from: string; to: string };
  returnWindow: { from: string; to: string };
  bucketDays: number;
  scope: "single" | "all";
  marketId: string | null;
  /** market_id → lead time in days. Missing markets fall back to the default. */
  leadTimeByMarket: Map<string, number>;
  now: Date;
}

export function mapStockPayload(payload: RpcPayload, opts: MapStockOptions): StockPosition {
  const todayIso = opts.now.toISOString().slice(0, 10);
  const rows = Array.isArray(payload.products) ? payload.products : [];

  // Mean damaged rate across products that have any returns — the baseline the
  // outlier flag compares against. Computed before the main pass because each
  // product needs the population figure.
  const damagedRates: number[] = [];
  for (const r of rows) {
    const returns = num(r.returned_to_shelf_units_all_time) + num(r.damaged_return_count);
    if (returns > 0) damagedRates.push(damagedRate(num(r.damaged_return_count), returns));
  }
  const meanDamagedRate =
    damagedRates.length > 0 ? damagedRates.reduce((s, n) => s + n, 0) / damagedRates.length : 0;

  const products: StockProduct[] = rows.map((r) => {
    const marketId = String(r.market_id ?? "");
    const unitCogs = num(r.unit_cogs);
    const physical = num(r.current_stock);
    const committed = num(r.committed_units);
    const freeToSell = physical - committed;

    const demandUnits = num(r.demand_units);
    const demandOrders = num(r.demand_orders);
    const effWindow = effectiveWindowDays(
      opts.windowDays,
      str(r.first_shipped_at),
      opts.now,
    );
    const rate = demandRatePerDay(demandUnits, effWindow);
    const confidence = demandConfidence(demandOrders);

    // The honesty rule made structural: when the sample cannot support a rate,
    // the caller is handed nothing to render rather than a confident-looking
    // date derived from four orders.
    const cover = confidence === "none" ? null : daysOfCover(freeToSell, rate);
    const outDate = stockOutDate(todayIso, cover);
    const leadTime = opts.leadTimeByMarket.get(marketId) ?? DEFAULT_SUPPLIER_LEAD_TIME_DAYS;
    const reorderBy = reorderByDate(outDate, leadTime);

    const returnedUnits = num(r.returned_units_rate_window);
    const deliveredUnits = num(r.delivered_units_rate_window);
    const returnSample = num(r.returned_orders_rate_window) + num(r.delivered_orders_rate_window);
    const dmgBase = num(r.returned_to_shelf_units_all_time) + num(r.damaged_return_count);
    const dmgRate = damagedRate(num(r.damaged_return_count), dmgBase);

    const drift = computeDrift({
      currentStock: physical,
      ledgerSumUnits: num(r.ledger_sum_units),
      shippedUnitsAllTime: num(r.shipped_units_all_time),
      returnedToShelfUnitsAllTime: num(r.returned_to_shelf_units_all_time),
      damagedReturnCount: num(r.damaged_return_count),
      unitCost: unitCogs,
    });

    const capital = splitCapital({
      physicalStock: physical,
      committed,
      ratePerDay: rate,
      unitCost: unitCogs,
    });

    const lastSale = str(r.last_sale_at);
    const oldestAwaiting = str(r.oldest_awaiting_scan_at);
    const lastCounted = str(r.last_counted_at);
    const carrierName = str(r.carrier_name);

    const series: DemandPoint[] = Array.isArray(r.demand_series)
      ? (r.demand_series as Record<string, unknown>[]).map((p) => ({
          day: String(p.day ?? ""),
          units: num(p.units),
          orders: num(p.orders),
        }))
      : [];

    return {
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      sku: str(r.sku),
      image_url: str(r.image_url),
      market_id: marketId,

      source: carrierName ? "carrier" : "own",
      carrier_name: carrierName,

      physical_stock: physical,
      committed,
      committed_orders: num(r.committed_orders),
      committed_already_deducted: num(r.committed_deducted_units),
      free_to_sell: freeToSell,
      coming_back: num(r.coming_back_units),

      demand_units: demandUnits,
      demand_orders: demandOrders,
      effective_window_days: effWindow,
      demand_rate_per_day: rate,
      demand_series: series,
      demand_bucket_days: opts.bucketDays,
      demand_is_inferred:
        demandOrders > 0 && num(r.demand_orders_inferred) / demandOrders > 0.5,

      days_of_cover: cover,
      stock_out_date: outDate,
      reorder_by_date: reorderBy,
      lead_time_days: leadTime,

      return_rate: returnRate(returnedUnits, deliveredUnits),
      return_sample_orders: returnSample,
      return_confidence: classifyConfidence(returnSample, returnSample),
      damaged_rate: dmgRate,
      is_damaged_outlier: isDamagedOutlier(dmgRate, meanDamagedRate),

      unit_cogs: unitCogs,
      stock_value: physical * unitCogs,
      engaged_value: capital.engaged,
      active_value: capital.active,
      dormant_value: capital.dormant,
      last_sale_at: lastSale,
      days_since_last_sale: lastSale
        ? daysBetweenISO(lastSale.slice(0, 10), todayIso)
        : null,

      expected_stock: drift.expectedStock,
      drift_units: drift.units,
      drift_value: drift.value,
      ledger_rows: num(r.ledger_rows),
      awaiting_scan_orders: num(r.awaiting_scan_orders),
      awaiting_scan_units: num(r.awaiting_scan_units),
      oldest_awaiting_scan_days: oldestAwaiting
        ? daysBetweenISO(oldestAwaiting.slice(0, 10), todayIso)
        : null,
      last_counted_at: lastCounted,
      days_since_count: lastCounted
        ? daysBetweenISO(lastCounted.slice(0, 10), todayIso)
        : null,

      confidence,
      state: classifyStockState({
        freeToSell,
        physicalStock: physical,
        demandUnits,
        coverDays: cover,
        reorderByDateISO: reorderBy,
        todayISO: todayIso,
        leadTimeDays: leadTime,
        confidence,
      }),
      low_stock_threshold: num(r.low_stock_threshold),
    };
  });

  const currencies = new Set(rows.map((r) => String(r.currency ?? "")).filter(Boolean));
  const mixedCurrencies = currencies.size > 1;

  const totals = buildTotals(products);
  const ledger = buildLedgerHealth(payload.ledger_health ?? {}, products);
  const actions = buildActions(products);

  return {
    window: {
      from: opts.window.from,
      to: opts.window.to,
      days: opts.windowDays,
      bucket_days: opts.bucketDays,
    },
    return_rate_window: {
      from: opts.returnWindow.from,
      to: opts.returnWindow.to,
      days: RETURN_RATE_WINDOW_DAYS,
    },
    scope: opts.scope,
    market_id: opts.marketId,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    mixed_currencies: mixedCurrencies,
    generated_at: opts.now.toISOString(),
    totals,
    ledger,
    actions,
    products,
  };
}

function buildTotals(products: StockProduct[]): StockTotals {
  const t: StockTotals = {
    products: products.length,
    physical_units: 0,
    committed_units: 0,
    free_to_sell_units: 0,
    stock_value: 0,
    engaged_value: 0,
    active_value: 0,
    dormant_value: 0,
    dormant_share: 0,
    dormant_products: 0,
    dormant_units: 0,
    dormant_avg_age_days: null,
    min_days_of_cover: null,
    min_cover_product_id: null,
    min_cover_stock_out_date: null,
    cover_ok_count: 0,
    cover_watch_count: 0,
    cover_urgent_count: 0,
    drift_units: 0,
    drift_value: 0,
    drift_products: 0,
    drift_share: 0,
    drift_daily_impact: 0,
    awaiting_scan_orders: 0,
    awaiting_scan_units: 0,
    oldest_awaiting_scan_days: null,
  };

  const dormantAges: number[] = [];

  for (const p of products) {
    t.physical_units += p.physical_stock;
    t.committed_units += p.committed;
    t.free_to_sell_units += p.free_to_sell;
    t.stock_value += p.stock_value;
    t.engaged_value += p.engaged_value;
    t.active_value += p.active_value;
    t.dormant_value += p.dormant_value;

    if (p.state === "dead" || p.state === "overstocked") {
      t.dormant_products += 1;
      t.dormant_units += Math.max(0, p.free_to_sell);
      if (p.days_since_last_sale !== null) dormantAges.push(p.days_since_last_sale);
    }

    if (p.days_of_cover !== null) {
      if (p.days_of_cover <= COVER_URGENT_DAYS) t.cover_urgent_count += 1;
      else if (p.days_of_cover <= COVER_WATCH_DAYS) t.cover_watch_count += 1;
      else t.cover_ok_count += 1;

      if (t.min_days_of_cover === null || p.days_of_cover < t.min_days_of_cover) {
        t.min_days_of_cover = p.days_of_cover;
        t.min_cover_product_id = p.id;
        t.min_cover_stock_out_date = p.stock_out_date;
      }
    }

    if (p.drift_units !== 0) {
      t.drift_products += 1;
      t.drift_units += p.drift_units;
      t.drift_value += p.drift_value;
    }

    t.awaiting_scan_orders += p.awaiting_scan_orders;
    t.awaiting_scan_units += p.awaiting_scan_units;
    if (
      p.oldest_awaiting_scan_days !== null &&
      (t.oldest_awaiting_scan_days === null ||
        p.oldest_awaiting_scan_days > t.oldest_awaiting_scan_days)
    ) {
      t.oldest_awaiting_scan_days = p.oldest_awaiting_scan_days;
    }
  }

  t.dormant_share = t.stock_value > 0 ? t.dormant_value / t.stock_value : 0;
  t.drift_share = t.products > 0 ? t.drift_products / t.products : 0;
  t.dormant_avg_age_days =
    dormantAges.length > 0
      ? Math.round(dormantAges.reduce((s, n) => s + n, 0) / dormantAges.length)
      : null;
  // Spread the unreconciled value over how long it has been accumulating, so
  // the figure reads as a rate rather than one alarming lump.
  t.drift_daily_impact =
    t.oldest_awaiting_scan_days && t.oldest_awaiting_scan_days > 0
      ? Math.abs(t.drift_value) / t.oldest_awaiting_scan_days
      : 0;

  return t;
}

function buildLedgerHealth(
  raw: Record<string, unknown>,
  products: StockProduct[],
): LedgerHealth {
  let unscannedValue = 0;
  let carrierHeld = 0;
  for (const p of products) {
    if (p.source === "carrier") carrierHeld += 1;
    unscannedValue += Math.abs(p.drift_value);
  }
  return {
    inventory_log_rows: num(raw.inventory_log_rows),
    scan_out_rows: num(raw.scan_out_rows),
    unscanned_shipped_units: products.reduce((s, p) => s + Math.abs(p.drift_units), 0),
    unscanned_shipped_value: unscannedValue,
    last_movement_at: str(raw.last_movement_at),
    carrier_held_products: carrierHeld,
  };
}

/**
 * The "actions prioritaires" list: what to do, ranked by the money attached.
 *
 * Each entry carries machine-readable detail only — the UI supplies every word,
 * because this module has no access to the locale.
 */
function buildActions(products: StockProduct[]): StockAction[] {
  const actions: StockAction[] = [];

  for (const p of products) {
    if (p.state === "dead" && p.dormant_value > 0) {
      actions.push({
        kind: "relaunch",
        product_id: p.id,
        product_name: p.name,
        amount: p.dormant_value,
        detail: {
          units: Math.max(0, p.free_to_sell),
          days_since_last_sale: p.days_since_last_sale,
        },
      });
    } else if (p.state === "out") {
      actions.push({
        kind: "liquidate",
        product_id: p.id,
        product_name: p.name,
        amount: Math.abs(p.free_to_sell) * p.unit_cogs,
        detail: { deficit: p.free_to_sell, committed: p.committed },
      });
    } else if (p.state === "reorder_now" || p.state === "watch") {
      actions.push({
        kind: "expedite",
        product_id: p.id,
        product_name: p.name,
        amount: p.demand_rate_per_day * p.lead_time_days * p.unit_cogs,
        detail: { stock_out_date: p.stock_out_date, reorder_by_date: p.reorder_by_date },
      });
    } else if (p.state === "overstocked") {
      actions.push({
        kind: "reduce_moq",
        product_id: p.id,
        product_name: p.name,
        amount: p.dormant_value,
        detail: { free_units: p.free_to_sell, days_of_cover: p.days_of_cover },
      });
    }
  }

  return actions.sort((a, b) => b.amount - a.amount);
}

export interface GetStockPositionInput {
  windowDays: DemandWindowDays;
  marketId: string | null;
  role: string;
  actorMarketId: string | null;
  now?: Date;
}

export async function getStockPosition(
  input: GetStockPositionInput,
): Promise<StockPosition> {
  const supabase = await createClient();
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? DEFAULT_DEMAND_WINDOW;
  const bucketDays = chooseBucketDays(windowDays);

  const period = lastNDaysPeriod(windowDays);
  const returnPeriod = lastNDaysEndingAt(RETURN_RATE_WINDOW_DAYS, period.to_date);

  const isSuperAdmin = input.role === "super_admin";
  const scopedMarketId = isSuperAdmin ? input.marketId : input.actorMarketId;

  const [rpc, leadTimes] = await Promise.all([
    supabase.rpc("get_stock_position", {
      p_market_id: scopedMarketId,
      p_from: period.from_date,
      p_to: period.to_date,
      p_bucket_days: bucketDays,
      p_rate_from: returnPeriod.from_date,
    }),
    getLeadTimeByMarket(supabase),
  ]);

  if (rpc.error) throw new Error(`get_stock_position failed: ${rpc.error.message}`);

  return mapStockPayload((rpc.data ?? {}) as RpcPayload, {
    windowDays,
    window: { from: period.from_date, to: period.to_date },
    returnWindow: { from: returnPeriod.from_date, to: period.to_date },
    bucketDays,
    scope: scopedMarketId ? "single" : "all",
    marketId: scopedMarketId,
    leadTimeByMarket: leadTimes,
    now,
  });
}

/**
 * Lead time per market in one read. `settings.value` is jsonb and this codebase
 * writes both `{ "value": 14 }` and a bare `14`, so both shapes are unwrapped.
 */
async function getLeadTimeByMarket(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await supabase
    .from("settings")
    .select("market_id, value")
    .eq("key", "supplier_lead_time_days");

  for (const row of data ?? []) {
    const raw = (row as { market_id: string; value: unknown }).value;
    const unwrapped =
      raw !== null && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
        ? (raw as { value: unknown }).value
        : raw;
    const n = Number(unwrapped);
    if (Number.isInteger(n) && n >= 0) {
      map.set((row as { market_id: string }).market_id, n);
    }
  }
  return map;
}

export { OVERSTOCK_COVER_DAYS };
