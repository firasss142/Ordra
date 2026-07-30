import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import { attributeOrderRevenue } from "@/lib/calculations/order-revenue-attribution";

/**
 * Folds one day of order activity into per-product rows.
 *
 * Deliberately pure: the cron route fetches, this decides. Every money split
 * goes through the same tested attribution helper the settlement path uses, so
 * the portal and the payout can never disagree about who earned what.
 *
 * The subtle rule is per-ORDER costs. A carrier charges one delivery fee for a
 * parcel regardless of how many products are inside it, so the fee is split
 * across the order's products rather than booked once per product — otherwise
 * a two-product order would invent a second delivery fee out of nothing.
 * Per-PRODUCT costs (packing, processing) are booked once per product.
 */

export interface RollupOrderLine {
  productId: string | null;
  lineTotal: number;
  quantity: number;
}

export interface RollupOrder {
  orderId: string;
  totalPrice: number;
  carrierId: string | null;
  lines: RollupOrderLine[];
}

export interface ProductCosts {
  unitCogs: number;
  packingCost: number;
  processingCost: number;
}

export interface CarrierFees {
  deliveryFee: number;
  returnFee: number;
}

export interface RollupInput {
  statDate: string;
  marketId: string;
  leadOrders: RollupOrder[];
  confirmedOrders: RollupOrder[];
  uploadedOrders: RollupOrder[];
  deliveredOrders: RollupOrder[];
  returnedOrders: RollupOrder[];
  products: Map<string, ProductCosts>;
  carriers: Map<string, CarrierFees>;
  /** productId -> that day's share of product-scoped ad spend. */
  adSpendDaily: Map<string, number>;
}

export interface DailyProductStat {
  stat_date: string;
  market_id: string;
  product_id: string;
  leads_count: number;
  confirmed_count: number;
  uploaded_count: number;
  delivered_count: number;
  returned_count: number;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  processing_cost: number;
  ad_spend_direct: number;
}

/** Internal accumulator, kept in integer millimes to avoid float drift. */
interface Acc {
  leads: number;
  confirmed: number;
  uploaded: number;
  delivered: number;
  returned: number;
  revenue: number;
  cogs: number;
  deliveryCost: number;
  returnCost: number;
  packingCost: number;
  processingCost: number;
  adSpend: number;
}

function emptyAcc(): Acc {
  return {
    leads: 0,
    confirmed: 0,
    uploaded: 0,
    delivered: 0,
    returned: 0,
    revenue: 0,
    cogs: 0,
    deliveryCost: 0,
    returnCost: 0,
    packingCost: 0,
    processingCost: 0,
    adSpend: 0,
  };
}

/** Distinct products in an order, in first-seen order. */
function productsOf(order: RollupOrder): string[] {
  const seen: string[] = [];
  for (const line of order.lines) {
    if (line.productId && !seen.includes(line.productId)) seen.push(line.productId);
  }
  return seen;
}

/** Split a single per-order fee across the order's products by line value. */
function splitOrderFee(order: RollupOrder, fee: number): Map<string, number> {
  return attributeOrderRevenue({
    totalPrice: fee,
    lines: order.lines.map((l) => ({ productId: l.productId, lineTotal: l.lineTotal })),
  });
}

export function buildDailyStats(input: RollupInput): DailyProductStat[] {
  const acc = new Map<string, Acc>();
  const get = (productId: string): Acc => {
    let a = acc.get(productId);
    if (!a) {
      a = emptyAcc();
      acc.set(productId, a);
    }
    return a;
  };

  // ── Funnel counts. An order counts once per distinct product it contains.
  for (const o of input.leadOrders) for (const p of productsOf(o)) get(p).leads += 1;
  for (const o of input.uploadedOrders) for (const p of productsOf(o)) get(p).uploaded += 1;

  // ── Confirmed: per-product costs begin here (packing + processing).
  for (const o of input.confirmedOrders) {
    for (const productId of productsOf(o)) {
      const a = get(productId);
      a.confirmed += 1;
      const costs = input.products.get(productId);
      if (costs) {
        a.packingCost += toMillimes(costs.packingCost);
        a.processingCost += toMillimes(costs.processingCost);
      }
    }
  }

  // ── Delivered: revenue realised, COGS and the delivery fee land here.
  for (const o of input.deliveredOrders) {
    const revenueByProduct = attributeOrderRevenue({
      totalPrice: o.totalPrice,
      lines: o.lines.map((l) => ({ productId: l.productId, lineTotal: l.lineTotal })),
    });
    for (const [productId, amount] of revenueByProduct) {
      get(productId).revenue += toMillimes(amount);
    }

    for (const productId of productsOf(o)) get(productId).delivered += 1;

    // COGS follows physical units, not money, so it uses quantity per line.
    for (const line of o.lines) {
      if (!line.productId) continue;
      const costs = input.products.get(line.productId);
      if (costs) {
        get(line.productId).cogs += toMillimes(costs.unitCogs * line.quantity);
      }
    }

    const fee = o.carrierId ? input.carriers.get(o.carrierId)?.deliveryFee ?? 0 : 0;
    if (fee > 0) {
      for (const [productId, share] of splitOrderFee(o, fee)) {
        get(productId).deliveryCost += toMillimes(share);
      }
    }
  }

  // ── Returned: the return fee, split the same way. No revenue, no COGS —
  // the goods came back.
  for (const o of input.returnedOrders) {
    for (const productId of productsOf(o)) get(productId).returned += 1;

    const fee = o.carrierId ? input.carriers.get(o.carrierId)?.returnFee ?? 0 : 0;
    if (fee > 0) {
      for (const [productId, share] of splitOrderFee(o, fee)) {
        get(productId).returnCost += toMillimes(share);
      }
    }
  }

  // ── Direct ad spend. A product with spend but no orders still needs a row,
  // otherwise the cost silently vanishes from the period.
  for (const [productId, amount] of input.adSpendDaily) {
    get(productId).adSpend += toMillimes(amount);
  }

  return [...acc.entries()].map(([productId, a]) => ({
    stat_date: input.statDate,
    market_id: input.marketId,
    product_id: productId,
    leads_count: a.leads,
    confirmed_count: a.confirmed,
    uploaded_count: a.uploaded,
    delivered_count: a.delivered,
    returned_count: a.returned,
    revenue: fromMillimes(a.revenue),
    cogs: fromMillimes(a.cogs),
    delivery_cost: fromMillimes(a.deliveryCost),
    return_cost: fromMillimes(a.returnCost),
    packing_cost: fromMillimes(a.packingCost),
    processing_cost: fromMillimes(a.processingCost),
    ad_spend_direct: fromMillimes(a.adSpend),
  }));
}
