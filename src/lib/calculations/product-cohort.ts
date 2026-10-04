// The money of one product's cohort: what its customers paid, and where it went.
//
// Owner's rules (2026-10-03), applied here and nowhere else:
//   · Revenue headline = « Encaissé » = paid by customers − carrier fees. The
//     paid amount is `orders.total_price` (the only revenue field), shared by
//     line price when an order holds several products.
//   · Darb: no flat fee. Each delivered parcel costs what Darb invoiced it
//     (else the quote recorded at upload, else the market's average, counted
//     in `carrier_estimated`). A failed Darb parcel costs nothing. Tunisia
//     keeps its carriers' flat fees until they send invoices — both arrive as
//     `delivery_cost` / `return_cost` on the line, so this module never asks
//     which carrier it is.
//   · Packaging is paid once per parcel that LEAVES (every uploaded order),
//     not per confirmation. Processing stays per confirmed order.
//   · Everything is on the cohort: orders received in the period, followed to
//     today. Ads are the period's spend on the product.

import {
  isUploadedBucket,
  lineBucket,
  type CohortLine,
} from "@/lib/products/cohort";

export interface CohortCosts {
  unit_cogs: number;
  packing_cost: number;
  processing_cost: number;
}

export interface CohortMoney {
  /** Delivered orders (+1 per product on a mixed order). */
  deliveries: number;
  /** Paid by customers on delivered orders, shared by line price. */
  paid: number;
  /** Carrier fees: delivery invoices on delivered parcels + return fees on failed ones. */
  carrier: number;
  /** Delivered parcels priced at the market average (no invoice, no quote). */
  carrier_estimated: number;
  /** paid − carrier. */
  encaisse: number;
  units: number;
  cogs: number;
  /** Parcels that left, shared by line price. */
  parcels: number;
  packing: number;
  /** Confirmed orders, shared by line price. */
  confirmed: number;
  processing: number;
  ads: number;
  net: number;
}

export function cohortMoney(
  lines: readonly CohortLine[],
  costs: CohortCosts,
  ads: number,
  averageDeliveryCost: number | null,
): CohortMoney {
  let deliveries = 0;
  let paid = 0;
  let carrier = 0;
  let estimated = 0;
  let units = 0;
  let parcels = 0;
  let confirmed = 0;

  for (const l of lines) {
    const bucket = lineBucket(l);
    if (bucket === "delivered") {
      deliveries += 1;
      paid += l.share * l.total_price;
      units += l.units;
      if (l.delivery_cost === null) {
        estimated += 1;
        carrier += l.share * (averageDeliveryCost ?? 0);
      } else {
        carrier += l.share * l.delivery_cost;
      }
    } else if (bucket === "failed") {
      carrier += l.share * l.return_cost;
    }
    if (isUploadedBucket(bucket)) parcels += l.share;
    if (l.confirmed || isUploadedBucket(bucket) || bucket === "to_upload") confirmed += l.share;
  }

  const encaisse = paid - carrier;
  const cogs = units * costs.unit_cogs;
  const packing = parcels * costs.packing_cost;
  const processing = confirmed * costs.processing_cost;
  const net = encaisse - cogs - packing - processing - ads;

  return {
    deliveries,
    paid,
    carrier,
    carrier_estimated: estimated,
    encaisse,
    units,
    cogs,
    parcels,
    packing,
    confirmed,
    processing,
    ads,
    net,
  };
}

/** Several products' money as one — the KPI strip. Sums lines, never averages ratios. */
export function sumMoney(list: readonly CohortMoney[]): CohortMoney {
  const out: CohortMoney = {
    deliveries: 0,
    paid: 0,
    carrier: 0,
    carrier_estimated: 0,
    encaisse: 0,
    units: 0,
    cogs: 0,
    parcels: 0,
    packing: 0,
    confirmed: 0,
    processing: 0,
    ads: 0,
    net: 0,
  };
  for (const m of list) {
    for (const k of Object.keys(out) as (keyof CohortMoney)[]) out[k] += m[k];
  }
  return out;
}

export interface PerDelivery {
  paid: number;
  carrier: number;
  encaisse: number;
  cogs: number;
  packing: number;
  processing: number;
  /** encaissé − product − packaging − processing: what one delivery earns before ads. */
  beforeAds: number;
  ads: number;
  net: number;
}

export function perDelivery(m: CohortMoney): PerDelivery | null {
  if (m.deliveries === 0) return null;
  const d = m.deliveries;
  const beforeAds = (m.encaisse - m.cogs - m.packing - m.processing) / d;
  return {
    paid: m.paid / d,
    carrier: m.carrier / d,
    encaisse: m.encaisse / d,
    cogs: m.cogs / d,
    packing: m.packing / d,
    processing: m.processing / d,
    beforeAds,
    ads: m.ads / d,
    net: m.net / d,
  };
}

/** What ads may cost per delivery before the product loses money. */
export function breakEvenAdsPerDelivery(m: CohortMoney): number | null {
  return perDelivery(m)?.beforeAds ?? null;
}

/**
 * The sheet's two sentences: what ads cost per delivery and as a share of what
 * the customer paid, next to everything else a delivery costs.
 */
export function adsInsight(m: CohortMoney): {
  ads_per_delivery: number;
  ads_share_of_paid: number;
  other_per_delivery: number;
} | null {
  if (m.deliveries === 0 || m.paid <= 0) return null;
  return {
    ads_per_delivery: m.ads / m.deliveries,
    ads_share_of_paid: m.ads / m.paid,
    other_per_delivery: (m.carrier + m.cogs + m.packing + m.processing) / m.deliveries,
  };
}

/** Net ÷ encaissé; null when nothing was cashed. */
export function marginOf(m: CohortMoney): number | null {
  return m.encaisse > 0 ? m.net / m.encaisse : null;
}

export type CostShareKey = "carrier" | "cogs" | "packing" | "processing" | "ads" | "profit";

/**
 * « Où vont 100 د.ل » — each cost as a share of what the customers paid.
 *
 * Profit is drawn only when positive. On a loss the costs exceed what was paid,
 * so the bar is scaled to the costs instead: it still sums to 1 and the ledger
 * beside it carries the negative figure.
 */
export function costShares(m: CohortMoney): { key: CostShareKey; share: number; amount: number }[] {
  const profit = Math.max(m.net, 0);
  const parts: [CostShareKey, number][] = [
    ["carrier", m.carrier],
    ["cogs", m.cogs],
    ["packing", m.packing],
    ["processing", m.processing],
    ["ads", m.ads],
    ["profit", profit],
  ];
  const costs = m.carrier + m.cogs + m.packing + m.processing + m.ads;
  const total = Math.max(m.paid, costs + profit);
  return parts.map(([key, amount]) => ({ key, amount, share: total > 0 ? amount / total : 0 }));
}
