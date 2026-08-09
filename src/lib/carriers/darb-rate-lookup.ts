/**
 * Pick the harvested rate that applies to one order's destination.
 *
 * Pure. No imports, no IO — the caller hands over the darb_shipping_rates rows
 * it already loaded for this destination.
 *
 * MISSING IS NOT ZERO. A row whose shipping_amount is null was never
 * successfully quoted; it is not a free delivery and must not match.
 */

export interface DarbRateRow {
  carrier_id: string;
  city: string;
  area: string;
  shipping_amount: number | null;
  currency: string;
  last_success_at: string | null;
}

export interface RateLookupKey {
  city: string;
  /**
   * null when the area has not been decided yet — the common case at intake for
   * a multi-area city (طرابلس alone has 92 areas; the agent picks one in the
   * dispatch modal).
   */
  area: string | null;
}

export function pickRateForOrder(
  rows: DarbRateRow[],
  key: RateLookupKey,
  carrierId?: string,
): DarbRateRow | null {
  const candidates = rows.filter(
    (r) =>
      r.city === key.city &&
      r.shipping_amount != null &&
      (carrierId == null || r.carrier_id === carrierId),
  );
  if (candidates.length === 0) return null;

  if (key.area != null) {
    const exact = candidates.find((r) => r.area === key.area);
    if (exact) return exact;
    // The area is real but not harvested yet — fall through to the city
    // maximum rather than reporting no price at all.
  }

  // Undecided (or unharvested) area: quote the most expensive area in the city.
  // Conservative, and applied identically to both accounts so that comparing
  // them stays fair — the point is the DIFFERENCE, not the absolute figure.
  return candidates.reduce((worst, r) =>
    (r.shipping_amount as number) > (worst.shipping_amount as number) ? r : worst,
  );
}
