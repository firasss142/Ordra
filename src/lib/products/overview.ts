// Assembles get_product_cohort's facts into the list rows and the product sheet.
// SERVER ONLY — called from the API routes; the money comes from
// lib/calculations/product-cohort.ts, the buckets from ./cohort.ts.

import {
  PARCEL_OUTCOMES,
  agentRows,
  confirmationRate,
  countCohort,
  dailyCounts,
  daysBetween,
  deliveryRate,
  emptyCounts,
  failureCauses,
  finalShare,
  groupByProduct,
  isProvisional,
  localDay,
  productSignal,
  rejectionGroups,
  stockCover,
  type CohortCounts,
  type CohortLine,
  type ParcelOutcome,
} from "./cohort";
import {
  adsInsight,
  breakEvenAdsPerDelivery,
  cohortMoney,
  costShares,
  marginOf,
  perDelivery,
  sumMoney,
  type CohortMoney,
} from "@/lib/calculations/product-cohort";
import { DEFAULT_SUPPLIER_LEAD_TIME_DAYS } from "@/types/settings";
import type {
  ProductOverviewRow,
  ProductSheetOverviewResponse,
  ProductsOverviewResponse,
  RowMoney,
  StockMove,
} from "@/types/product-overview";

/** The product columns the builders read. */
export interface CatalogueProduct {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  is_active: boolean;
  default_price: number | null;
  current_stock: number;
  low_stock_threshold: number;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost: number | null;
}

/** The columns toCatalogueProduct reads. Never "*". */
export const CATALOGUE_COLUMNS =
  "id, name, sku, image_url, is_active, default_price, current_stock, low_stock_threshold, unit_cogs, packing_cost, confirmation_processing_cost";

export function toCatalogueProduct(r: Record<string, unknown>): CatalogueProduct {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    sku: (r.sku as string | null) ?? null,
    image_url: (r.image_url as string | null) ?? null,
    is_active: r.is_active === true,
    default_price: r.default_price === null || r.default_price === undefined ? null : Number(r.default_price),
    current_stock: n(r.current_stock),
    low_stock_threshold: n(r.low_stock_threshold),
    unit_cogs: n(r.unit_cogs),
    packing_cost: n(r.packing_cost),
    confirmation_processing_cost:
      r.confirmation_processing_cost === null || r.confirmation_processing_cost === undefined
        ? null
        : Number(r.confirmation_processing_cost),
  };
}

/** supplier_lead_time_days as stored (bare or wrapped, read as text); 14 when unset or invalid. */
export function leadDaysOf(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_SUPPLIER_LEAD_TIME_DAYS;
}

/** get_product_cohort's jsonb, normalised. */
export interface CohortPayload {
  from: string;
  to: string;
  tz: string;
  lines: CohortLine[];
  ads: { product_id: string; day: string; amount: number }[];
  left_30d: { product_id: string; units: number }[];
  avg_delivery_cost: number | null;
  last_order_at: string | null;
  last_ad_day: string | null;
  counted: { product_id: string; counted_at: string }[];
  delivered_days: { day: string; n: number }[];
  stock: { scanned_30d: number; returned_30d: number; moves: StockMove[] };
  last_order_at_product: string | null;
  users: { id: string; full_name: string | null; avatar_url: string | null }[];
}

type Raw = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function arr(v: unknown): Raw[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Raw[]) : [];
}

const OUTCOMES = new Set<string>(PARCEL_OUTCOMES);

function toLine(r: Raw): CohortLine {
  const outcome = str(r.outcome);
  return {
    order_id: String(r.order_id ?? ""),
    product_id: String(r.product_id ?? ""),
    created_at: String(r.created_at ?? ""),
    status: String(r.status ?? ""),
    outcome: outcome && OUTCOMES.has(outcome) ? (outcome as ParcelOutcome) : null,
    outcome_at: str(r.outcome_at),
    assigned_to: str(r.assigned_to),
    rejection_reason: str(r.rejection_reason),
    failure_cause: str(r.failure_cause),
    attempts: num(r.attempts) ?? 0,
    units: num(r.units) ?? 0,
    share: num(r.share) ?? 1,
    total_price: num(r.total_price) ?? 0,
    delivery_cost: num(r.delivery_cost),
    return_cost: num(r.return_cost) ?? 0,
    confirmed: r.confirmed === true,
  };
}

/** The RPC answers '{}' when it refuses; every field falls back to empty. */
export function normalizeCohortPayload(raw: unknown): CohortPayload {
  const r = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const stock = (r.stock && typeof r.stock === "object" ? r.stock : {}) as Raw;
  return {
    from: String(r.from ?? ""),
    to: String(r.to ?? ""),
    tz: String(r.tz ?? "UTC"),
    lines: arr(r.lines).map(toLine),
    ads: arr(r.ads).map((a) => ({
      product_id: String(a.product_id ?? ""),
      day: String(a.day ?? ""),
      amount: num(a.amount) ?? 0,
    })),
    left_30d: arr(r.left_30d).map((a) => ({
      product_id: String(a.product_id ?? ""),
      units: num(a.units) ?? 0,
    })),
    avg_delivery_cost: num(r.avg_delivery_cost),
    last_order_at: str(r.last_order_at),
    last_ad_day: str(r.last_ad_day),
    counted: arr(r.counted)
      .map((a) => ({ product_id: String(a.product_id ?? ""), counted_at: String(a.counted_at ?? "") }))
      .filter((a) => a.counted_at !== ""),
    delivered_days: arr(r.delivered_days).map((a) => ({ day: String(a.day ?? ""), n: num(a.n) ?? 0 })),
    stock: {
      scanned_30d: num(stock.scanned_30d) ?? 0,
      returned_30d: num(stock.returned_30d) ?? 0,
      moves: arr(stock.moves).map((m) => ({
        at: String(m.at ?? ""),
        reason: String(m.reason ?? ""),
        change: num(m.change) ?? 0,
        balance_after: num(m.balance_after),
      })),
    },
    last_order_at_product: str(r.last_order_at_product),
    users: arr(r.users).map((u) => ({
      id: String(u.id ?? ""),
      full_name: str(u.full_name),
      avatar_url: str(u.avatar_url),
    })),
  };
}

interface BuildArgs {
  cohort: CohortPayload;
  leadDays: number;
  currency: string;
  now: Date;
}

function costsOf(p: CatalogueProduct) {
  return {
    unit_cogs: Number(p.unit_cogs) || 0,
    packing_cost: Number(p.packing_cost) || 0,
    processing_cost: Number(p.confirmation_processing_cost ?? 0) || 0,
  };
}

function rowMoney(m: CohortMoney): RowMoney {
  return {
    deliveries: m.deliveries,
    paid: m.paid,
    carrier: m.carrier,
    encaisse: m.encaisse,
    cogs: m.cogs,
    packing: m.packing,
    processing: m.processing,
    ads: m.ads,
    net: m.net,
  };
}

function adsTotals(cohort: CohortPayload): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of cohort.ads) out.set(a.product_id, (out.get(a.product_id) ?? 0) + a.amount);
  return out;
}

function sumCounts(list: CohortCounts[]): CohortCounts {
  const out = emptyCounts();
  for (const c of list) {
    for (const k of Object.keys(out) as (keyof CohortCounts)[]) out[k] += c[k];
  }
  return out;
}

export function buildProductsOverview({
  catalogue,
  cohort,
  leadDays,
  currency,
}: BuildArgs & { catalogue: CatalogueProduct[] }): ProductsOverviewResponse {
  const days = daysBetween(cohort.from, cohort.to);
  const byProduct = groupByProduct(cohort.lines);
  const ads = adsTotals(cohort);
  const left = new Map(cohort.left_30d.map((l) => [l.product_id, l.units]));
  const counted = new Set(cohort.counted.map((c) => c.product_id));

  const rows: ProductOverviewRow[] = [];
  const activeMoney: CohortMoney[] = [];
  const activeCounts: CohortCounts[] = [];
  const spark = days.map(() => 0);

  for (const p of catalogue) {
    const lines = byProduct.get(p.id) ?? [];
    const counts = countCohort(lines);
    const money = cohortMoney(lines, costsOf(p), ads.get(p.id) ?? 0, cohort.avg_delivery_cost);
    const productSpark = dailyCounts(
      lines.map((l) => l.created_at),
      cohort.from,
      cohort.to,
      cohort.tz,
    );
    const unitsLeft = left.get(p.id) ?? 0;
    const cover = stockCover(Number(p.current_stock) || 0, unitsLeft);
    rows.push({
      id: p.id,
      name: p.name,
      sku: p.sku,
      image_url: p.image_url,
      is_active: p.is_active,
      default_price: p.default_price,
      current_stock: Number(p.current_stock) || 0,
      low_stock_threshold: Number(p.low_stock_threshold) || 0,
      counts,
      confirmation: confirmationRate(counts),
      delivery: deliveryRate(counts),
      provisional: isProvisional(counts),
      money: rowMoney(money),
      margin: marginOf(money),
      shares: costShares(money),
      spark: productSpark,
      units_left_30d: unitsLeft,
      cover,
      signal: productSignal(
        { active: p.is_active, cover, received: counts.received, net: money.net },
        leadDays,
      ),
    });
    if (p.is_active) {
      activeMoney.push(money);
      activeCounts.push(counts);
      productSpark.forEach((v, i) => {
        spark[i] += v;
      });
    }
  }

  const total = sumMoney(activeMoney);
  const counts = sumCounts(activeCounts);

  return {
    period: { from: cohort.from, to: cohort.to, tz: cohort.tz, days },
    currency,
    lead_days: leadDays,
    market: {
      last_order_at: cohort.last_order_at,
      last_ad_day: cohort.last_ad_day,
      any_counted: catalogue.some((p) => p.is_active && counted.has(p.id)),
      avg_delivery_cost: cohort.avg_delivery_cost,
    },
    totals: {
      active: activeCounts.length,
      received: counts.received,
      uploaded: counts.uploaded,
      rejected: counts.rejected,
      delivered: counts.delivered,
      failed: counts.failed,
      in_flight: counts.in_flight,
      paid: total.paid,
      carrier: total.carrier,
      encaisse: total.encaisse,
      ads: total.ads,
      net: total.net,
      confirmation: confirmationRate(counts),
      delivery: deliveryRate(counts),
      margin: marginOf(total),
      final: finalShare(counts),
      spark,
    },
    rows,
  };
}

/** More than a day without an order: the market's intake has stopped. */
const INTAKE_SILENCE_MS = 24 * 60 * 60 * 1000;

export function buildProductSheet({
  product,
  cohort,
  leadDays,
  currency,
  now,
}: BuildArgs & { product: CatalogueProduct }): ProductSheetOverviewResponse {
  const days = daysBetween(cohort.from, cohort.to);
  const index = new Map(days.map((d, i) => [d, i]));
  const lines = cohort.lines.filter((l) => l.product_id === product.id);
  const counts = countCohort(lines);
  const ads = cohort.ads.filter((a) => a.product_id === product.id);
  const adsTotal = ads.reduce((s, a) => s + a.amount, 0);
  const money = cohortMoney(lines, costsOf(product), adsTotal, cohort.avg_delivery_cost);

  const delivered = days.map(() => 0);
  for (const d of cohort.delivered_days) {
    const i = index.get(d.day);
    if (i !== undefined) delivered[i] += d.n;
  }
  const adsByDay = days.map(() => 0);
  for (const a of ads) {
    const i = index.get(a.day);
    if (i !== undefined) adsByDay[i] += a.amount;
  }

  let stopIndex: number | null = null;
  let stopAt: string | null = null;
  if (cohort.last_order_at && now.getTime() - Date.parse(cohort.last_order_at) > INTAKE_SILENCE_MS) {
    stopAt = cohort.last_order_at;
    stopIndex = index.get(localDay(cohort.last_order_at, cohort.tz)) ?? null;
  }

  const names = new Map(cohort.users.map((u) => [u.id, u]));
  const agents = agentRows(lines);
  const unitsLeft = cohort.left_30d.find((l) => l.product_id === product.id)?.units ?? 0;

  return {
    period: { from: cohort.from, to: cohort.to, tz: cohort.tz, days },
    currency,
    lead_days: leadDays,
    counts,
    confirmation: confirmationRate(counts),
    delivery: deliveryRate(counts),
    provisional: isProvisional(counts),
    final: finalShare(counts),
    money: {
      ...rowMoney(money),
      units: money.units,
      parcels: money.parcels,
      confirmed: money.confirmed,
      carrier_estimated: money.carrier_estimated,
    },
    margin: marginOf(money),
    per_delivery: perDelivery(money),
    break_even: breakEvenAdsPerDelivery(money),
    shares: costShares(money),
    insight: adsInsight(money),
    why: { rejections: rejectionGroups(lines), failures: failureCauses(lines) },
    trend: {
      received: dailyCounts(
        lines.map((l) => l.created_at),
        cohort.from,
        cohort.to,
        cohort.tz,
      ),
      delivered,
      ads: adsByDay,
      stop_index: stopIndex,
      stop_at: stopAt,
    },
    agents: {
      rows: agents.agents.map((a) => ({
        ...a,
        name: names.get(a.agent_id)?.full_name ?? "",
        avatar_url: names.get(a.agent_id)?.avatar_url ?? null,
      })),
      unassigned: agents.unassigned,
    },
    stock: {
      counted_at: cohort.counted.find((c) => c.product_id === product.id)?.counted_at ?? null,
      scanned_30d: cohort.stock.scanned_30d,
      returned_30d: cohort.stock.returned_30d,
      units_left_30d: unitsLeft,
      cover: stockCover(Number(product.current_stock) || 0, unitsLeft),
      moves: cohort.stock.moves,
    },
    last_order_at: cohort.last_order_at_product,
    avg_delivery_cost: cohort.avg_delivery_cost,
  };
}
