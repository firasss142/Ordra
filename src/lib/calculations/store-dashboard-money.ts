// Accueil — the market's money (owner only; prototypes/dashboard-v2.html,
// `money` and « Comment on arrive à ce chiffre »).
//
// Produits & marges' rules, at the scale of the market:
//   · Payé = Σ orders.total_price of DELIVERED orders (the only revenue field);
//   · product cost on delivered units, packaging per parcel that left,
//     processing per confirmed order — per product, through cohortMoney;
//   · carrier at the invoice per delivered parcel (else the quote, else the
//     market's average); a failed parcel costs its return fee (0 for Darb);
//   · ads = EVERY campaign of the market over the period, day by day.
// No profit per store: ads are attached to products, not yet to stores.

import { cohortMoney, type CohortCosts } from "@/lib/calculations/product-cohort";
import type { CohortLine } from "@/lib/products/cohort";

interface MoneyOrder {
  bk: string;
  price: number;
  deliveryCost: number | null;
  returnCost: number;
}

export interface StoreDashMoney {
  paid: number;
  cogs: number;
  carrier: number;
  packing: number;
  processing: number;
  ads: number;
  profit: number;
}

export function paidOf(orders: readonly Pick<MoneyOrder, "bk" | "price">[]): number {
  let s = 0;
  for (const o of orders) if (o.bk === "d") s += o.price;
  return s;
}

export function storeDashboardMoney(args: {
  orders: readonly MoneyOrder[];
  lines: readonly CohortLine[];
  costs: Record<string, CohortCosts>;
  ads: number;
  avgDeliveryCost: number | null;
}): StoreDashMoney {
  const paid = paidOf(args.orders);
  let carrier = 0;
  for (const o of args.orders) {
    if (o.bk === "d") carrier += o.deliveryCost ?? args.avgDeliveryCost ?? 0;
    else if (o.bk === "f") carrier += o.returnCost;
  }
  const byProduct = new Map<string, CohortLine[]>();
  for (const l of args.lines) {
    const arr = byProduct.get(l.product_id);
    if (arr) arr.push(l);
    else byProduct.set(l.product_id, [l]);
  }
  let cogs = 0;
  let packing = 0;
  let processing = 0;
  for (const [pid, lines] of byProduct) {
    const c = args.costs[pid] ?? { unit_cogs: 0, packing_cost: 0, processing_cost: 0 };
    const m = cohortMoney(lines, c, 0, args.avgDeliveryCost);
    cogs += m.cogs;
    packing += m.packing;
    processing += m.processing;
  }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    paid: r(paid),
    cogs: r(cogs),
    carrier: r(carrier),
    packing: r(packing),
    processing: r(processing),
    ads: r(args.ads),
    profit: r(paid - cogs - carrier - packing - processing - args.ads),
  };
}
