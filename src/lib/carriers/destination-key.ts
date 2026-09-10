/**
 * A stable identifier for "where this order is going", used to key the carrier
 * rate quote.
 *
 * WHY THIS EXISTS: Libya's two Darb Assabil accounts are geographic, not
 * interchangeable — they price the same address 5–25 LYD apart and neither is
 * "the cheap one" (see docs/carrier-rate-recommendation.md). A quote is
 * therefore only ever true *for one destination*. `useCarrierRates` used to key
 * its SWR cache on the order id alone, with a 60 s dedupe window, so changing an
 * order's destination left the badge showing the previous address's price and
 * the previous account as "meilleur choix".
 *
 * The key mirrors what `/api/carriers/rates` actually resolves the quote from:
 * the bound `darb_destination_id` first, then the free-text `customer_city`
 * (which the route feeds to `resolveDarbAny`). `city_id` and
 * `dexpress_state_id` are deliberately absent — the route never reads them, so
 * including them would invent cache misses that change nothing.
 */
export interface DestinationSource {
  darb_destination_id?: number | null;
  customer_city?: string | null;
}

export function destinationKey(order: DestinationSource | null | undefined): string {
  if (!order) return "none";

  if (order.darb_destination_id != null) return `darb:${order.darb_destination_id}`;

  const city = order.customer_city?.trim().toLowerCase();
  return city ? `city:${city}` : "none";
}
