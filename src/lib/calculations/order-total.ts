// Order grand total = product subtotal (+10% when paid online by card) + delivery fee.
//
// The +10% applies to the PRODUCT SUBTOTAL ONLY, never the delivery fee. It exists for
// Libya online card orders: the delivery company deducts 10% of the product value when we
// withdraw the collected cash, so we charge the customer +10% to land on the true product
// value (net P&L is unchanged — it is a pass-through to the carrier).
//
// Rounds to millimes (3 decimals) to match orders.total_price NUMERIC(10,3) and the rounding
// used by every server recompute path.
export function computeOrderTotal(
  subtotal: number,
  deliveryFee: number,
  cardPayment: boolean,
): number {
  const adjustedSubtotal = cardPayment ? subtotal * 1.1 : subtotal;
  return Math.round((adjustedSubtotal + (deliveryFee ?? 0)) * 1000) / 1000;
}
