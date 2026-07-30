import { toMillimes, fromMillimes } from "./math";

/**
 * Allocation of market-wide ad spend across products.
 *
 * `ad_spend` rows with `product_id IS NULL` are genuine market spend (brand and
 * generic campaigns) but were previously charged to no product, so every
 * product's net profit was overstated and product-level profits never summed to
 * the market P&L — the reconciliation gap recorded in
 * plans/finances-restructure-redesign.md.
 *
 * That gap stops being cosmetic the moment an investor takes a share of net
 * profit AFTER ad spend, so market-wide spend is allocated pro-rata by the
 * product's delivered revenue in the same period.
 *
 * Allocation is exact: it runs in integer millimes and distributes the rounding
 * remainder by the largest-remainder method, so the parts always sum back to
 * the whole.
 */

export interface ProductRevenue {
  productId: string;
  revenue: number;
}

export function allocateMarketAdSpend(params: {
  marketWideSpend: number;
  productRevenues: ProductRevenue[];
}): Map<string, number> {
  const { marketWideSpend, productRevenues } = params;
  const allocation = new Map<string, number>();

  if (productRevenues.length === 0) return allocation;

  const spendMillimes = toMillimes(marketWideSpend);
  if (spendMillimes === 0) {
    for (const { productId } of productRevenues) allocation.set(productId, 0);
    return allocation;
  }

  const revenueMillimes = productRevenues.map((p) => toMillimes(p.revenue));
  const totalRevenue = revenueMillimes.reduce((a, b) => a + b, 0);

  // No product earned anything this period, but the spend was still incurred.
  // Refusing to allocate it would understate cost and overstate every
  // investor's share, so split it evenly.
  const weights =
    totalRevenue === 0 ? productRevenues.map(() => 1) : revenueMillimes;
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Floor each share, then hand the remaining millimes to the largest
  // fractional parts. Guarantees sum(parts) === whole.
  const exact = weights.map((w) => (spendMillimes * w) / totalWeight);
  const floored = exact.map(Math.floor);
  let remainder = spendMillimes - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  const final = [...floored];
  for (let i = 0; remainder > 0 && i < order.length; i++, remainder--) {
    final[order[i].index] += 1;
  }

  productRevenues.forEach((p, i) => {
    allocation.set(p.productId, fromMillimes(final[i]));
  });

  return allocation;
}
