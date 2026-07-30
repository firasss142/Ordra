import { toMillimes, fromMillimes } from "./math";

/**
 * Splits a single order's revenue across the products it actually contains.
 *
 * The rest of the P&L attributes 100% of `orders.total_price` to the
 * denormalized `orders.product_id` and never reads `order_items`. For a
 * market-level dashboard that nets out; for a per-product investor payout it
 * credits the wrong product, and therefore the wrong person.
 *
 * `total_price` is the revenue source of truth and includes the per-order
 * `delivery_fee` and the Libya card surcharge, so it is distributed in
 * proportion to `line_total` rather than by summing line totals — that way the
 * uplift lands on every product proportionally instead of on one.
 *
 * Exact by construction: integer millimes plus largest-remainder distribution,
 * so the parts always sum back to total_price.
 */

export interface OrderLine {
  productId: string | null;
  lineTotal: number;
}

export function attributeOrderRevenue(params: {
  totalPrice: number;
  lines: OrderLine[];
}): Map<string, number> {
  const { totalPrice, lines } = params;
  const attribution = new Map<string, number>();

  // A line with no mapped product cannot be credited to anyone. Dropping it
  // here (rather than allocating to null) means the mapped products absorb the
  // full order value instead of the revenue silently disappearing.
  const usable = lines.filter(
    (l): l is OrderLine & { productId: string } => l.productId !== null
  );
  if (usable.length === 0) return attribution;

  const totalMillimes = toMillimes(totalPrice);
  if (totalMillimes === 0) {
    for (const l of usable) attribution.set(l.productId, 0);
    return attribution;
  }

  // Merge repeated lines for the same product before allocating.
  const merged = new Map<string, number>();
  for (const l of usable) {
    merged.set(l.productId, (merged.get(l.productId) ?? 0) + toMillimes(l.lineTotal));
  }

  const productIds = [...merged.keys()];
  const lineTotals = productIds.map((id) => merged.get(id) ?? 0);
  const sumLines = lineTotals.reduce((a, b) => a + b, 0);

  // Degenerate order (all lines zero-priced, e.g. a full-value promo) — split
  // the order value evenly rather than dropping it.
  const weights = sumLines === 0 ? productIds.map(() => 1) : lineTotals;
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const exact = weights.map((w) => (totalMillimes * w) / totalWeight);
  const floored = exact.map(Math.floor);
  let remainder = totalMillimes - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  const final = [...floored];
  for (let i = 0; remainder > 0 && i < order.length; i++, remainder--) {
    final[order[i].index] += 1;
  }

  productIds.forEach((id, i) => attribution.set(id, fromMillimes(final[i])));
  return attribution;
}
