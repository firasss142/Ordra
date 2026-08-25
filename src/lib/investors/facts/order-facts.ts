import { fromMillimes, toMillimes } from "@/lib/calculations/math";
import { attributeOrderRevenue } from "@/lib/calculations/order-revenue-attribution";

/**
 * Per-order fact derivation — the correctness core of investor v2.
 *
 * One fact per (order, product). Pure: no I/O, integer-millime arithmetic.
 *
 * Rules (owner decisions, 2026-08-18):
 *  - cohort_date = market-local day of orders.created_at (deal membership);
 *  - event timestamps = MIN(order_history.created_at) per stage, which dedupes
 *    re-confirmed / re-uploaded orders; "uploaded" falls back to the first
 *    shipped-stage event so TN legacy orders lacking an explicit `uploaded`
 *    row still count once anything downstream exists;
 *  - revenue on delivered only; a return charges return cost only and reverses
 *    revenue/COGS only if a prior delivered event exists (reversal_applies);
 *  - delivery/return cost = REAL BILLED amount (darb_shipments.billed_
 *    shipping_amount × line share). Unbilled outcome → not final, money 0,
 *    pending_reason='awaiting_billing' — unless the carrier is flagged
 *    investor_billing_mode='flat_is_final', in which case the flat fee is
 *    accepted (cost_source='flat');
 *  - Dexpress-carried orders are EXCLUDED (row kept, money 0, count printable);
 *  - deleted orders excluded; orders with no product excluded;
 *  - unit-cost snapshots freeze at first observed outcome (existing snapshot
 *    always wins), so editing products.unit_cogs later never rewrites history;
 *  - multi-product orders: revenue/carrier/packing/processing split by
 *    line_total (largest remainder), COGS by quantity.
 */

export type BillingMode = "billed_only" | "flat_is_final";

export interface OrderFactInput {
  order: {
    id: string;
    marketId: string;
    status: string;
    productId: string | null;
    quantity: number;
    totalPrice: number;
    carrierId: string | null;
    createdAt: string; // ISO timestamptz
  };
  carrier: {
    code: string | null;
    deliveryFee: number;
    returnFee: number;
    investorBillingMode: BillingMode;
  } | null;
  items: { productId: string | null; quantity: number; lineTotal: number }[];
  history: { statusTo: string; createdAt: string }[];
  billedShippingAmount: number | null;
  productCosts: Map<string, { unitCogs: number; packingCost: number; processingCost: number }>;
  existing: Map<
    string,
    {
      unitCogsSnapshot: number | null;
      packingCostSnapshot: number | null;
      processingCostSnapshot: number | null;
      snapshotAt: string | null;
    }
  >;
  timeZone: string; // IANA, e.g. Africa/Tripoli
  now?: string; // ISO, for snapshot_at
}

export type FactStage = "received" | "not_shipped" | "in_flight" | "delivered" | "returned";
export type FactOutcome = "delivered" | "returned" | null;
export type ExcludedReason = "dexpress" | "deleted" | "no_product" | null;

/** Column-shaped row, ready for a PostgREST upsert on (order_id, product_id). */
export interface OrderFactRow {
  order_id: string;
  product_id: string;
  market_id: string;
  carrier_id: string | null;
  carrier_code: string | null;
  order_created_at: string;
  cohort_date: string;
  uploaded_at: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  uploaded_date: string | null;
  delivered_date: string | null;
  returned_date: string | null;
  current_status: string;
  stage: FactStage;
  outcome: FactOutcome;
  reversal_applies: boolean;
  quantity: number;
  line_total: number;
  line_share: number;
  product_count: number;
  unit_cogs_snapshot: number | null;
  packing_cost_snapshot: number | null;
  processing_cost_snapshot: number | null;
  snapshot_at: string | null;
  revenue_gross: number;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  processing_cost: number;
  carrier_billed_amount: number | null;
  cost_source: "billed" | "flat" | null;
  gross_profit: number;
  net_contribution: number;
  is_final: boolean;
  pending_reason: "awaiting_billing" | null;
  excluded_reason: ExcludedReason;
  expected_revenue: number;
}

export const DEXPRESS_CODE = "dexpress";
export const NOT_SHIPPED_STATUSES = new Set(["rejected", "cancelled"]);
/** Any of these in order_history means the parcel left our hands. */
export const SHIPPED_STAGE_STATUSES = new Set([
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "unverified",
  "to_be_returned",
  "received",
  "delivered",
  "returned",
]);

const dtfCache = new Map<string, Intl.DateTimeFormat>();
/** YYYY-MM-DD of an ISO instant in `timeZone`. */
export function localDateISO(iso: string, timeZone: string): string {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dtfCache.set(timeZone, f);
  }
  // en-CA yields YYYY-MM-DD.
  return f.format(new Date(iso));
}

function minIso(a: string | null, b: string): string {
  return a === null || b < a ? b : a;
}

/** Largest-remainder split of `totalMillimes` by `weights` (all >= 0). */
function splitMillimes(totalMillimes: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum === 0 ? weights.map(() => 1) : weights;
  const tw = w.reduce((a, b) => a + b, 0);
  const exact = w.map((x) => (totalMillimes * x) / tw);
  const floored = exact.map(Math.floor);
  let rem = totalMillimes - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k].i] += 1;
  return out;
}

export function deriveOrderFacts(input: OrderFactInput): OrderFactRow[] {
  const { order, carrier, history, timeZone } = input;
  const now = input.now ?? new Date().toISOString();

  // ── Lines ────────────────────────────────────────────────────────────────
  type Line = { productId: string; quantity: number; lineTotal: number };
  const merged = new Map<string, Line>();
  for (const it of input.items) {
    if (!it.productId) continue;
    const cur = merged.get(it.productId);
    if (cur) {
      cur.quantity += it.quantity;
      cur.lineTotal += it.lineTotal;
    } else {
      merged.set(it.productId, { productId: it.productId, quantity: it.quantity, lineTotal: it.lineTotal });
    }
  }
  let lines: Line[] = [...merged.values()];
  if (lines.length === 0 && order.productId) {
    lines = [{ productId: order.productId, quantity: order.quantity, lineTotal: order.totalPrice }];
  }

  const cohortDate = localDateISO(order.createdAt, timeZone);

  // ── Events (MIN per stage) ───────────────────────────────────────────────
  let uploadedAt: string | null = null;
  let deliveredAt: string | null = null;
  let returnedAt: string | null = null;
  for (const h of history) {
    if (SHIPPED_STAGE_STATUSES.has(h.statusTo)) uploadedAt = minIso(uploadedAt, h.createdAt);
    if (h.statusTo === "delivered") deliveredAt = minIso(deliveredAt, h.createdAt);
    if (h.statusTo === "returned") returnedAt = minIso(returnedAt, h.createdAt);
  }
  // A terminal status without a history row (legacy import) still counts.
  if (order.status === "delivered" && !deliveredAt) deliveredAt = order.createdAt;
  if (order.status === "returned" && !returnedAt) returnedAt = order.createdAt;
  if ((deliveredAt || returnedAt) && !uploadedAt) uploadedAt = deliveredAt ?? returnedAt;

  // ── Outcome / stage ──────────────────────────────────────────────────────
  let outcome: FactOutcome = null;
  if (order.status === "returned") outcome = "returned";
  else if (order.status === "delivered" || (deliveredAt && !NOT_SHIPPED_STATUSES.has(order.status)))
    outcome = "delivered";
  const reversalApplies = outcome === "returned" && !!deliveredAt && !!returnedAt && deliveredAt < returnedAt;

  let stage: FactStage;
  if (outcome) stage = outcome;
  else if (NOT_SHIPPED_STATUSES.has(order.status)) stage = "not_shipped";
  else if (uploadedAt) stage = "in_flight";
  else stage = "received";

  // ── Exclusion ────────────────────────────────────────────────────────────
  let excluded: ExcludedReason = null;
  if (order.status === "deleted") excluded = "deleted";
  else if (carrier?.code === DEXPRESS_CODE) excluded = "dexpress";

  if (lines.length === 0) {
    // No product anywhere: one placeholder row so the gap is auditable. We
    // cannot reference a product, so this cannot be persisted as-is; the
    // loader drops rows whose product_id is empty and counts them.
    return [
      {
        order_id: order.id,
        product_id: "",
        market_id: order.marketId,
        carrier_id: order.carrierId,
        carrier_code: carrier?.code ?? null,
        order_created_at: order.createdAt,
        cohort_date: cohortDate,
        uploaded_at: uploadedAt,
        delivered_at: deliveredAt,
        returned_at: returnedAt,
        uploaded_date: uploadedAt ? localDateISO(uploadedAt, timeZone) : null,
        delivered_date: deliveredAt ? localDateISO(deliveredAt, timeZone) : null,
        returned_date: returnedAt ? localDateISO(returnedAt, timeZone) : null,
        current_status: order.status,
        stage,
        outcome,
        reversal_applies: reversalApplies,
        quantity: order.quantity,
        line_total: order.totalPrice,
        line_share: 1,
        product_count: 0,
        unit_cogs_snapshot: null,
        packing_cost_snapshot: null,
        processing_cost_snapshot: null,
        snapshot_at: null,
        revenue_gross: 0,
        revenue: 0,
        cogs: 0,
        delivery_cost: 0,
        return_cost: 0,
        packing_cost: 0,
        processing_cost: 0,
        carrier_billed_amount: null,
        cost_source: null,
        gross_profit: 0,
        net_contribution: 0,
        is_final: false,
        pending_reason: null,
        excluded_reason: "no_product",
        expected_revenue: 0,
      },
    ];
  }

  // ── Splits ───────────────────────────────────────────────────────────────
  const revenueSplit = attributeOrderRevenue({
    totalPrice: order.totalPrice,
    lines: lines.map((l) => ({ productId: l.productId, lineTotal: l.lineTotal })),
  });
  const weights = lines.map((l) => toMillimes(l.lineTotal));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const shares = sumW === 0 ? lines.map(() => 1 / lines.length) : weights.map((w) => w / sumW);

  const billedMillimes = input.billedShippingAmount === null ? null : toMillimes(input.billedShippingAmount);
  const billedSplit = billedMillimes === null ? null : splitMillimes(billedMillimes, weights);

  // Per-order packing/processing: the max across the order's products, then
  // split by line share (one parcel is packed once).
  let packingUnit = 0;
  let processingUnit = 0;
  for (const l of lines) {
    const ex = input.existing.get(l.productId);
    const pc = input.productCosts.get(l.productId);
    packingUnit = Math.max(packingUnit, ex?.packingCostSnapshot ?? pc?.packingCost ?? 0);
    processingUnit = Math.max(processingUnit, ex?.processingCostSnapshot ?? pc?.processingCost ?? 0);
  }
  const packingSplit = splitMillimes(toMillimes(packingUnit), weights);
  const processingSplit = splitMillimes(toMillimes(processingUnit), weights);

  const flatFee = (() => {
    if (!carrier) return null;
    if (outcome === "delivered") return toMillimes(carrier.deliveryFee);
    if (outcome === "returned") return toMillimes(carrier.returnFee);
    return null;
  })();
  const flatSplit = flatFee === null ? null : splitMillimes(flatFee, weights);

  const flatIsFinal = carrier?.investorBillingMode === "flat_is_final";

  // ── Rows ─────────────────────────────────────────────────────────────────
  return lines.map((l, i) => {
    const ex = input.existing.get(l.productId);
    const pc = input.productCosts.get(l.productId);

    // Snapshots: existing wins; else take current costs at first outcome.
    const takeSnapshot = outcome !== null && !excluded;
    const unitCogsSnap = ex?.unitCogsSnapshot ?? (takeSnapshot ? (pc?.unitCogs ?? 0) : null);
    const packingSnap = ex?.packingCostSnapshot ?? (takeSnapshot ? (pc?.packingCost ?? 0) : null);
    const processingSnap = ex?.processingCostSnapshot ?? (takeSnapshot ? (pc?.processingCost ?? 0) : null);
    const snapshotAt = ex?.snapshotAt ?? (takeSnapshot ? now : null);

    const revShare = toMillimes(revenueSplit.get(l.productId) ?? 0);

    let revenueGross = 0;
    let revenue = 0;
    let cogs = 0;
    let deliveryCost = 0;
    let returnCost = 0;
    let packing = 0;
    let processing = 0;
    let carrierBilled: number | null = billedSplit ? billedSplit[i] : null;
    let costSource: "billed" | "flat" | null = null;
    let isFinal = false;
    let pendingReason: "awaiting_billing" | null = null;
    let expectedRevenue = 0;

    if (!excluded && outcome) {
      const carrierKnown = carrierBilled !== null || (flatIsFinal && flatSplit !== null);
      const carrierMillimes =
        carrierBilled !== null ? carrierBilled : flatIsFinal && flatSplit ? flatSplit[i] : null;
      costSource = carrierBilled !== null ? "billed" : carrierKnown ? "flat" : null;

      if (deliveredAt) revenueGross = revShare;
      if (carrierKnown && carrierMillimes !== null) {
        isFinal = true;
        if (outcome === "delivered") {
          revenue = revenueGross;
          cogs = toMillimes(unitCogsSnap ?? 0) * l.quantity;
          deliveryCost = carrierMillimes;
        } else {
          // returned: revenue reversed to 0 (only counted if delivered first,
          // which revenue_gross records); return cost only, never both.
          returnCost = carrierMillimes;
        }
        packing = packingSplit[i];
        processing = processingSplit[i];
      } else {
        pendingReason = "awaiting_billing";
      }
    } else if (!excluded && stage === "in_flight") {
      expectedRevenue = revShare;
    }

    const gross = revenue - cogs - deliveryCost - returnCost;
    const net = gross - packing - processing;

    return {
      order_id: order.id,
      product_id: l.productId,
      market_id: order.marketId,
      carrier_id: order.carrierId,
      carrier_code: carrier?.code ?? null,
      order_created_at: order.createdAt,
      cohort_date: cohortDate,
      uploaded_at: uploadedAt,
      delivered_at: deliveredAt,
      returned_at: returnedAt,
      uploaded_date: uploadedAt ? localDateISO(uploadedAt, timeZone) : null,
      delivered_date: deliveredAt ? localDateISO(deliveredAt, timeZone) : null,
      returned_date: returnedAt ? localDateISO(returnedAt, timeZone) : null,
      current_status: order.status,
      stage,
      outcome,
      reversal_applies: reversalApplies,
      quantity: l.quantity,
      line_total: l.lineTotal,
      line_share: Number(shares[i].toFixed(8)),
      product_count: lines.length,
      unit_cogs_snapshot: unitCogsSnap,
      packing_cost_snapshot: packingSnap,
      processing_cost_snapshot: processingSnap,
      snapshot_at: snapshotAt,
      revenue_gross: fromMillimes(revenueGross),
      revenue: fromMillimes(revenue),
      cogs: fromMillimes(cogs),
      delivery_cost: fromMillimes(deliveryCost),
      return_cost: fromMillimes(returnCost),
      packing_cost: fromMillimes(packing),
      processing_cost: fromMillimes(processing),
      carrier_billed_amount: carrierBilled === null ? null : fromMillimes(carrierBilled),
      cost_source: costSource,
      gross_profit: fromMillimes(gross),
      net_contribution: fromMillimes(net),
      is_final: isFinal,
      pending_reason: pendingReason,
      excluded_reason: excluded,
      expected_revenue: fromMillimes(expectedRevenue),
    };
  });
}
