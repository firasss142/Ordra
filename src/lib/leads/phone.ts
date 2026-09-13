/**
 * Canonical form of a phone number, and therefore of a customer's identity:
 * `customers.phone_normalized` is keyed on it and `customers.risk_class` is
 * counted per key.
 *
 * Mirrored exactly by `public.normalize_phone` in SQL
 * (supabase/migrations/20260926000002_normalize_phone_trunk_zero.sql). The two
 * must agree: the functional index `idx_orders_market_phone_norm` stores keys
 * built by the SQL side, and lookups come from this one.
 */
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  // Remove formatting characters: spaces, dashes, dots, parentheses
  let digits = raw.replace(/[\s\-.() ]/g, "");
  // Strip leading + sign to handle as digits
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  // Strip 00-prefix international dialing (00216, 00218), then the bare
  // country codes 216 (Tunisia) / 218 (Libya).
  if (digits.startsWith("00216")) digits = digits.slice(5);
  else if (digits.startsWith("00218")) digits = digits.slice(5);
  else if (digits.startsWith("216") && digits.length > 3) digits = digits.slice(3);
  else if (digits.startsWith("218") && digits.length > 3) digits = digits.slice(3);

  // National trunk zero. Libyan numbers are written both "0916063026" and
  // "916063026" for the same subscriber; without this, one buyer becomes two
  // customer rows each holding half a history — which is how a twice-returned
  // buyer came back reading as brand new.
  //
  // Guarded on a 9-digit remainder, which is Libya's plan. Tunisia's numbers
  // are 8 digits and never carry the zero, so no TN pair can collide here.
  if (/^0[0-9]{9}$/.test(digits)) {
    digits = digits.slice(1);
  }

  return digits;
}
