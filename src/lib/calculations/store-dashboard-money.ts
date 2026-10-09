// Accueil — the market's money (owner only; prototypes/dashboard-v9.html, the
// « Chiffre d'affaires » panel and each store's CA). orders.total_price is the only
// revenue field.

interface MoneyOrder {
  bk: string;
  price: number;
}

/** Chiffre d'affaires of orders received: Σ orders.total_price. */
export function caOf(orders: readonly Pick<MoneyOrder, "price">[]): number {
  let s = 0;
  for (const o of orders) s += o.price;
  return s;
}

/** Encaissé: Σ orders.total_price of DELIVERED orders. */
export function paidOf(orders: readonly MoneyOrder[]): number {
  let s = 0;
  for (const o of orders) if (o.bk === "d") s += o.price;
  return s;
}
