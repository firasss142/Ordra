/**
 * Stock position maths for the stock console.
 *
 * WHY THIS FILE WAS REWRITTEN. Every figure here used to be derived from
 * `inventory_log` rows with `reason = 'scanned'`. Production holds 16 ledger
 * rows in total and has never recorded a single scan, so `avgDailySales`
 * returned 0 for every product, `daysOfSupply` returned null, `classifyHealth`
 * answered "healthy" for everything, and the page rendered a full-green
 * all-clear over four empty panels while two products sat at negative stock.
 *
 * Demand is therefore taken from the order flow, and the ledger is measured
 * rather than trusted — `computeDrift` exists to put that gap on the page.
 *
 * Raw sums come from `get_stock_position`; every ratio, date and verdict is
 * derived here so it stays testable without a database.
 */
import {
  CONFIDENCE_LOW_MIN,
  CONFIDENCE_OK_MIN,
  type Confidence,
} from "@/lib/dashboard/confidence";
import {
  OVERSTOCK_COVER_DAYS,
  COVER_WATCH_DAYS,
  type StockState,
} from "@/lib/inventory/stock-position-types";

export const DAMAGED_OUTLIER_FLOOR = 0.1;
export const DAMAGED_OUTLIER_MULTIPLIER = 2;

const MS_PER_DAY = 86_400_000;

/* ────────────────────────── dates ────────────────────────── */

/** Shift a YYYY-MM-DD date by whole days. UTC, so no DST drift. */
export function addDaysISO(fromISO: string, days: number): string {
  const d = new Date(`${fromISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromISO` to `toISO`. Negative when the target is behind. */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/* ────────────────────────── demand ────────────────────────── */

/**
 * The nominal window, narrowed to how long the product has actually been selling.
 *
 * A product first shipped three days into a 90-day window sells at units/3, not
 * units/90. Dividing by the nominal window would report a thirtieth of the true
 * rate and quietly hide an imminent stockout. Never returns 0.
 *
 * A part-day is floored rather than rounded up, which biases the rate slightly
 * HIGH. That direction is deliberate: an overstated rate shortens cover and
 * raises a reorder flag early, while an understated one hides a stockout. For
 * an inventory alarm a false positive is cheap and a false negative is not.
 */
export function effectiveWindowDays(
  windowDays: number,
  firstShippedAt: string | null,
  now: Date,
): number {
  if (!firstShippedAt) return Math.max(1, windowDays);
  const age = Math.floor((now.getTime() - Date.parse(firstShippedAt)) / MS_PER_DAY);
  return Math.max(1, Math.min(windowDays, age));
}

export function demandRatePerDay(units: number, effectiveWindow: number): number {
  if (effectiveWindow <= 0 || units <= 0) return 0;
  return units / effectiveWindow;
}

/**
 * Sample-size confidence for a demand figure.
 *
 * Thresholds are imported, never redeclared, so the stock console and the
 * dashboard cannot drift apart on what "too thin to draw" means.
 */
export function demandConfidence(demandOrders: number): Confidence {
  if (demandOrders < CONFIDENCE_LOW_MIN) return "none";
  if (demandOrders < CONFIDENCE_OK_MIN) return "low";
  return "ok";
}

/**
 * Days of stock left, measured against what is FREE to sell — not what is on
 * the shelf. Units already promised to a customer cannot cover the next order.
 *
 * Returns null when nothing sells: that is unknowable, not infinite. Returns 0
 * rather than a negative number when a product is oversold.
 */
export function daysOfCover(freeToSell: number, ratePerDay: number): number | null {
  if (ratePerDay <= 0) return null;
  if (freeToSell <= 0) return 0;
  return Math.floor(freeToSell / ratePerDay);
}

export function stockOutDate(todayISO: string, cover: number | null): string | null {
  if (cover === null) return null;
  return addDaysISO(todayISO, cover);
}

/**
 * When an order has to be placed. Deliberately NOT clamped to today — a date in
 * the past means the order is already late, and clamping would erase the alarm.
 *
 * There is no purchase-order table, so this answers "when must an order be
 * placed IF NONE HAS BEEN"; it cannot subtract stock already inbound.
 */
export function reorderByDate(stockOutISO: string | null, leadTimeDays: number): string | null {
  if (!stockOutISO) return null;
  return addDaysISO(stockOutISO, -leadTimeDays);
}

/** 1 for windows up to 28 days, 7 beyond — caps a sparkline at ~28 points. */
export function chooseBucketDays(windowDays: number): number {
  return windowDays > 28 ? 7 : 1;
}

/* ────────────────────────── returns ────────────────────────── */

/** Null when nothing has resolved — an unknown rate is not a 0 % rate. */
export function returnRate(returnedUnits: number, deliveredUnits: number): number | null {
  const total = returnedUnits + deliveredUnits;
  if (total <= 0) return null;
  return returnedUnits / total;
}

export function damagedRate(damagedCount: number, totalReturns: number): number {
  if (totalReturns <= 0) return 0;
  return damagedCount / totalReturns;
}

export function isDamagedOutlier(rate: number, meanRate: number): boolean {
  if (meanRate <= 0) return false;
  if (rate < DAMAGED_OUTLIER_FLOOR) return false;
  return rate >= meanRate * DAMAGED_OUTLIER_MULTIPLIER;
}

/* ────────────────────────── reconciliation ────────────────────────── */

export interface DriftInput {
  currentStock: number;
  ledgerSumUnits: number;
  shippedUnitsAllTime: number;
  returnedToShelfUnitsAllTime: number;
  damagedReturnCount: number;
  unitCost: number;
}

export interface Drift {
  expectedStock: number;
  units: number;
  value: number;
}

/**
 * What the shelf claims, against what the order flow allows.
 *
 * expected = ledger − shipped + (returned to shelf − damaged)
 * drift    = current − expected
 *
 * Damaged returns never go back on the shelf, so they are removed from the
 * credit. Call the result "unreconciled units", never shrinkage: it is
 * dominated by shipments that were never scanned, and carrier-warehouse
 * fulfilment legitimately writes no ledger row at all.
 */
export function computeDrift(input: DriftInput): Drift {
  const expectedStock =
    input.ledgerSumUnits -
    input.shippedUnitsAllTime +
    Math.max(0, input.returnedToShelfUnitsAllTime - input.damagedReturnCount);
  const units = input.currentStock - expectedStock;
  return { expectedStock, units, value: units * input.unitCost };
}

/* ────────────────────────── capital ────────────────────────── */

export interface CapitalSplitInput {
  physicalStock: number;
  committed: number;
  ratePerDay: number;
  unitCost: number;
}

export interface CapitalSplit {
  engaged: number;
  active: number;
  dormant: number;
}

/**
 * Partition a product's stock value into three mutually exclusive buckets that
 * sum to `physicalStock × unitCost`:
 *
 * - engaged — units already promised to a customer and on their way
 * - active  — units on the shelf covered by the next 90 days of demand
 * - dormant — everything else: no demand behind it, or more than 90 days of it
 *
 * The three sum to the whole precisely so the tile and the treemap can never
 * disagree with the headline they sit under.
 */
export function splitCapital(input: CapitalSplitInput): CapitalSplit {
  const { physicalStock, committed, ratePerDay, unitCost } = input;
  if (physicalStock <= 0) return { engaged: 0, active: 0, dormant: 0 };

  const engagedUnits = Math.min(physicalStock, Math.max(0, committed));
  const onShelf = physicalStock - engagedUnits;
  const coverable = ratePerDay > 0 ? Math.ceil(ratePerDay * OVERSTOCK_COVER_DAYS) : 0;
  const activeUnits = Math.min(onShelf, coverable);
  const dormantUnits = onShelf - activeUnits;

  return {
    engaged: engagedUnits * unitCost,
    active: activeUnits * unitCost,
    dormant: dormantUnits * unitCost,
  };
}

/* ────────────────────────── verdict ────────────────────────── */

export interface StockStateInput {
  freeToSell: number;
  physicalStock: number;
  demandUnits: number;
  coverDays: number | null;
  reorderByDateISO: string | null;
  todayISO: string;
  leadTimeDays: number;
  confidence: Confidence;
}

/**
 * One verdict per product, in precedence order.
 *
 * `dead` outranks `unknown` because zero demand is a fact, not a thin sample —
 * a product nobody ordered all window does not need a bigger sample to judge.
 */
export function classifyStockState(i: StockStateInput): StockState {
  if (i.freeToSell <= 0) return "out";
  if (i.demandUnits <= 0 && i.physicalStock > 0) return "dead";
  if (i.confidence === "none") return "unknown";
  if (i.reorderByDateISO && daysBetweenISO(i.todayISO, i.reorderByDateISO) <= 0) {
    return "reorder_now";
  }
  if (i.coverDays !== null && i.coverDays > OVERSTOCK_COVER_DAYS) return "overstocked";
  if (i.coverDays !== null && i.coverDays <= COVER_WATCH_DAYS) return "watch";
  return "ok";
}
