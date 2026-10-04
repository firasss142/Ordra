// Performance › Commandes — « L'argent » (owner only).
//
// The price of the orders RECEIVED in the period, by what they became:
// Livré (delivered — the same figure as Produits' « Payé par les clients »),
// Perdu en retours (came back, or cancelled before leaving), Encore en route.
// Revenue = orders.total_price ONLY. With a product filter, a mixed order
// counts only the chosen products' part of its price, shared by line value
// exactly as Produits shares it (product_order_lines.share).
//
// Rejected and never-real orders were never shipped: they are not lost money.

import type { Bk, PerfLine, ProductSel } from "@/lib/performance/orders/facts";

export interface Money {
  mDel: number;
  mLost: number;
  mRoad: number;
}

export function orderValue(o: { price: number; lines: PerfLine[] }, sel: ProductSel): number {
  if (!Object.keys(sel).length) return o.price;
  let share = 0;
  for (const l of o.lines) {
    const s = sel[l.p];
    if (s === undefined) continue;
    if (s === null || l.v.some((v) => s.includes(v))) share += l.share;
  }
  return Math.round(o.price * Math.min(1, share) * 1000) / 1000;
}

export function moneyOf(list: readonly { bk: Bk; price: number; lines: PerfLine[] }[], sel: ProductSel): Money {
  const m: Money = { mDel: 0, mLost: 0, mRoad: 0 };
  for (const o of list) {
    if (o.bk === "d") m.mDel += orderValue(o, sel);
    else if (o.bk === "f" || o.bk === "b") m.mLost += orderValue(o, sel);
    else if (o.bk === "r") m.mRoad += orderValue(o, sel);
  }
  return m;
}

/** Share of the shipped value (delivered + lost) that was lost, in %. */
export function lostShare(m: Money): number | null {
  const shipped = m.mDel + m.mLost;
  return shipped ? (m.mLost / shipped) * 100 : null;
}

/** Σ value of any list (the drawer's « Valeur »). */
export function valueOf(list: readonly { price: number; lines: PerfLine[] }[], sel: ProductSel): number {
  return list.reduce((s, o) => s + orderValue(o, sel), 0);
}
