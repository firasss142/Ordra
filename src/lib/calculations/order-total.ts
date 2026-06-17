// Order grand total = product subtotal (+10% when paid online by card) + delivery fee.
//
// The +10% applies to the PRODUCT SUBTOTAL ONLY, never the delivery fee. It exists for
// Libya online card orders settled via the legacy COD cash flow (e.g. Dexpress): the
// delivery company deducts 10% of the product value when we withdraw the collected cash,
// so we charge the customer +10% to land on the true product value (net P&L is unchanged —
// it is a pass-through to the carrier).
//
// `applyCardSurcharge` gates that +10%. It defaults to `true` (back-compat). Pass `false`
// for carriers with NATIVE online payment that don't take the 10% cut — Darb Assabil charges
// the card fee on its own side (allowCardPayment), so inflating the subtotal would double-bill
// the customer. There, card_payment is expressed on the dispatch payload, not the price.
//
// Rounds to millimes (3 decimals) to match orders.total_price NUMERIC(10,3) and the rounding
// used by every server recompute path.
export function computeOrderTotal(
  subtotal: number,
  deliveryFee: number,
  cardPayment: boolean,
  applyCardSurcharge: boolean = true,
): number {
  const adjustedSubtotal =
    cardPayment && applyCardSurcharge ? subtotal * 1.1 : subtotal;
  return Math.round((adjustedSubtotal + (deliveryFee ?? 0)) * 1000) / 1000;
}

export function roundLineTotal(quantity: number, unitPrice: number): number {
  return Math.round(unitPrice * quantity * 1000) / 1000;
}
